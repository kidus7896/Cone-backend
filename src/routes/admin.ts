import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { authenticator } from "otplib";
import { z } from "zod";
import { recordAudit, recordModeration } from "../admin/audit";
import {
  canChangeRole,
  canSuspend,
  isStaffRole,
  moderationTransition,
  slugify,
  validateFieldDefs,
} from "../admin/rules";
import { requireRole } from "../auth/middleware";
import { serializeUser } from "../auth/serialize";
import { deleteAllSessions } from "../auth/session";
import { prisma } from "../db";
import { asyncHandler, badRequest, notFound, parseBody } from "../lib/errors";
import { phoneSearchDigits } from "../lib/phone";
import { blank, pageOf, pagingShape, skipOf } from "../lib/query";
import { getSettings, saveSettings } from "../lib/settings";
import { serializeListing } from "../listings/serialize";
import { loadListing, publicWhere } from "../listings/service";

export const adminRouter = Router();

// Every admin route needs a signed-in moderator or super admin. Staff have already passed
// the authenticator step, because no session is created without it.
adminRouter.use(requireRole("moderator", "super_admin"));
const superAdminOnly = requireRole("super_admin");

const reasonSchema = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300);

// ---------- Helpers ----------

async function activeCounts(ownerIds: string[]): Promise<Map<string, number>> {
  if (ownerIds.length === 0) return new Map();
  const rows = await prisma.listing.groupBy({
    by: ["ownerId"],
    where: { ownerId: { in: ownerIds }, ...publicWhere() },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.ownerId, r._count._all]));
}

function serializeReport(report: {
  listing?: { title: string; status: string } | null;
  id: string;
  listingId: string | null;
  reportedUserId: string | null;
  reason: string;
  note: string | null;
  status: string;
  resolutionNote: string | null;
  createdAt: Date;
}) {
  return {
    id: report.id,
    listingId: report.listingId,
    listingTitle: report.listing?.title ?? null,
    listingStatus: report.listing?.status ?? null,
    userId: report.reportedUserId,
    reason: report.reason,
    note: report.note,
    status: report.status,
    resolutionNote: report.resolutionNote,
    createdAt: report.createdAt.toISOString(),
  };
}

// ---------- GET /admin/dashboard ----------

adminRouter.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [newUsers7d, newListings7d, pendingListings, openReports, grouped, totalUsers, suspendedUsers, resolvedReports] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.listing.count({ where: { createdAt: { gte: since }, status: { not: "draft" } } }),
      prisma.listing.count({ where: { status: "pending_review" } }),
      prisma.report.count({ where: { status: "open" } }),
      prisma.listing.groupBy({ by: ["categoryId"], where: publicWhere(), _count: { _all: true } }),
      prisma.user.count(),
      prisma.user.count({ where: { status: "suspended" } }),
      prisma.report.count({ where: { status: "resolved" } }),
    ]);

    const categories = await prisma.category.findMany({
      where: { id: { in: grouped.map((g) => g.categoryId) } },
      select: { id: true, name: true },
    });
    const names = new Map(categories.map((c) => [c.id, c.name]));

    res.json({
      newUsers7d,
      newListings7d,
      pendingListings,
      openReports,
      resolvedReports,
      totalUsers,
      suspendedUsers,
      activeListings: grouped.reduce((n, g) => n + g._count._all, 0),
      listingsByCategory: grouped
        .map((g) => ({ categoryId: g.categoryId, name: names.get(g.categoryId) ?? "Unknown", count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    });
  })
);

// ---------- Listings: queue, search, moderate ----------

const statusEnum = z.enum(["draft", "pending_review", "active", "rejected", "paused", "sold", "expired"]);

// GET /admin/listings  (drafts are private and never shown to staff)
adminRouter.get(
  "/listings",
  asyncHandler(async (req, res) => {
    const q = parseBody(
      z.object({
        status: z.preprocess(blank, statusEnum.optional()),
        q: z.preprocess(blank, z.string().trim().max(100).optional()),
        ...pagingShape,
      }),
      req.query
    );
    if (q.status === "draft") throw badRequest("Drafts are private to their owners");

    const where: Prisma.ListingWhereInput = {
      status: q.status ?? { not: "draft" },
      ...(q.q ? { OR: [{ id: q.q }, { title: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    // The review queue is first in, first out. Other views show the latest changes first.
    const direction = q.status === "pending_review" ? "asc" : "desc";

    const [total, rows] = await prisma.$transaction([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        orderBy: [{ updatedAt: direction }, { id: direction }],
        skip: skipOf(q.page, q.pageSize),
        take: q.pageSize,
        include: { images: { orderBy: { order: "asc" } }, owner: true },
      }),
    ]);

    const counts = await activeCounts([...new Set(rows.map((r) => r.ownerId))]);
    const items = rows.map((r) =>
      serializeListing(r, r.owner, { activeListings: counts.get(r.ownerId) ?? 0, isFavorite: false })
    );
    res.json(pageOf(items, total, q.page, q.pageSize));
  })
);

// POST /admin/listings/:id/moderate
adminRouter.post(
  "/listings/:id/moderate",
  asyncHandler(async (req, res) => {
    const staff = req.user!;
    const body = parseBody(
      z.object({ action: z.enum(["approve", "reject", "remove"]), reason: reasonSchema.optional() }),
      req.body
    );
    if (body.action !== "approve" && !body.reason) {
      throw badRequest("A reason is required", { reason: "Tell the seller why" });
    }

    const listing = await loadListing(req.params.id);
    if (!listing || listing.status === "draft") throw notFound("Listing not found");
    if (listing.ownerId === staff.id) throw badRequest("You cannot moderate your own listing");

    const result = moderationTransition(listing.status, body.action);
    if (!result.ok) throw badRequest(result.message);

    const settings = await getSettings();
    const approving = body.action === "approve";

    await prisma.$transaction(async (tx) => {
      // The status condition makes sure two moderators cannot act on the same state twice.
      const changed = await tx.listing.updateMany({
        where: { id: listing.id, status: listing.status },
        data: {
          status: result.status,
          rejectReason: approving ? null : body.reason,
          expiresAt: approving ? new Date(Date.now() + settings.listingExpiryDays * 86_400_000) : undefined,
        },
      });
      if (changed.count !== 1) {
        throw badRequest("Someone else already changed this listing. Reload and try again.");
      }
      await recordModeration(tx, staff.id, "listing", listing.id, body.action, body.reason);
      await recordAudit(tx, staff.id, `listing.${body.action}`, "listing", listing.id, {
        from: listing.status,
        to: result.status,
        reason: body.reason ?? null,
      });
    });

    const updated = await loadListing(listing.id);
    const counts = await activeCounts([listing.ownerId]);
    res.json(
      serializeListing(updated!, updated!.owner, {
        activeListings: counts.get(listing.ownerId) ?? 0,
        isFavorite: false,
      })
    );
  })
);

// ---------- Reports ----------

// GET /admin/reports  (open reports: oldest first)
adminRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const q = parseBody(
      z.object({ status: z.preprocess(blank, z.enum(["open", "resolved"]).optional()), ...pagingShape }),
      req.query
    );
    const where: Prisma.ReportWhereInput = q.status ? { status: q.status } : {};
    const direction = q.status === "open" ? "asc" : "desc";

    const [total, rows] = await prisma.$transaction([
      prisma.report.count({ where }),
      prisma.report.findMany({
        where,
        orderBy: [{ createdAt: direction }, { id: direction }],
        skip: skipOf(q.page, q.pageSize),
        take: q.pageSize,
        include: { listing: { select: { title: true, status: true } } },
      }),
    ]);
    res.json(pageOf(rows.map(serializeReport), total, q.page, q.pageSize));
  })
);

// POST /admin/reports/:id/resolve
// action "dismiss" (default) only closes the report; "remove_listing" also takes the listing down.
adminRouter.post(
  "/reports/:id/resolve",
  asyncHandler(async (req, res) => {
    const staff = req.user!;
    const { note, action } = parseBody(
      z.object({
        note: z.string().trim().min(1, "Write a short note").max(500),
        action: z.enum(["dismiss", "remove_listing"]).default("dismiss"),
      }),
      req.body
    );

    const report = await prisma.report.findUnique({
      where: { id: req.params.id },
      include: { listing: { select: { id: true, ownerId: true, status: true, title: true } } },
    });
    if (!report) throw notFound("Report not found");

    const target = action === "remove_listing" ? report.listing : null;
    if (action === "remove_listing") {
      if (!target) throw badRequest("This report has no listing to remove");
      if (target.ownerId === staff.id) throw badRequest("You cannot moderate your own listing");
    }
    const removal = target ? moderationTransition(target.status, "remove") : null;
    if (removal && !removal.ok) throw badRequest(removal.message);

    await prisma.$transaction(async (tx) => {
      const changed = await tx.report.updateMany({
        where: { id: report.id, status: "open" },
        data: { status: "resolved", resolutionNote: note, handledById: staff.id },
      });
      if (changed.count !== 1) throw badRequest("This report was already resolved");

      if (target && removal && removal.ok) {
        const moved = await tx.listing.updateMany({
          where: { id: target.id, status: target.status },
          data: { status: removal.status, rejectReason: note },
        });
        if (moved.count !== 1) throw badRequest("The listing changed while you were resolving. Reload and try again.");
        await recordModeration(tx, staff.id, "listing", target.id, "remove", note);
        await recordAudit(tx, staff.id, "listing.remove", "listing", target.id, {
          from: target.status,
          to: removal.status,
          reason: note,
          reportId: report.id,
        });
      }
      await recordAudit(tx, staff.id, "report.resolve", "report", report.id, { note, action });
    });

    const updated = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
      include: { listing: { select: { title: true, status: true } } },
    });
    res.json(serializeReport(updated));
  })
);

// ---------- Users ----------

// GET /admin/users?q=  (name, phone fragment or exact id)
adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = parseBody(
      z.object({ q: z.preprocess(blank, z.string().trim().max(100).optional()), ...pagingShape }),
      req.query
    );

    let where: Prisma.UserWhereInput = {};
    if (q.q) {
      const or: Prisma.UserWhereInput[] = [{ id: q.q }, { name: { contains: q.q, mode: "insensitive" } }];
      const digits = phoneSearchDigits(q.q);
      if (digits) or.push({ phone: { contains: digits } });
      where = { OR: or };
    }

    const [total, rows] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: skipOf(q.page, q.pageSize),
        take: q.pageSize,
      }),
    ]);
    res.json(pageOf(rows.map(serializeUser), total, q.page, q.pageSize));
  })
);

// POST /admin/users/:id/status  (suspend or reactivate, reason required)
adminRouter.post(
  "/users/:id/status",
  asyncHandler(async (req, res) => {
    const staff = req.user!;
    const { action, reason } = parseBody(
      z.object({ action: z.enum(["suspend", "reactivate"]), reason: reasonSchema }),
      req.body
    );

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound("User not found");

    if (action === "suspend") {
      const allowed = canSuspend(staff, target);
      if (!allowed.ok) throw badRequest(allowed.message);
      if (target.status === "suspended") throw badRequest("This user is already suspended");
    } else if (target.status !== "suspended") {
      throw badRequest("Only a suspended user can be reactivated");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: target.id },
        data: { status: action === "suspend" ? "suspended" : "active" },
      });
      await recordModeration(tx, staff.id, "user", target.id, action, reason);
      await recordAudit(tx, staff.id, `user.${action}`, "user", target.id, { reason });
      return user;
    });

    // A suspended user is signed out everywhere straight away. Their listings disappear from
    // public pages because public queries require an active owner.
    if (action === "suspend") await deleteAllSessions(target.id);
    res.json(serializeUser(updated));
  })
);

// POST /admin/users/:id/role  (super admin only)
adminRouter.post(
  "/users/:id/role",
  superAdminOnly,
  asyncHandler(async (req, res) => {
    const staff = req.user!;
    const { role } = parseBody(z.object({ role: z.enum(["user", "moderator", "super_admin"]) }), req.body);

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound("User not found");

    const superAdmins = await prisma.user.count({ where: { role: "super_admin" } });
    const allowed = canChangeRole(staff, target, role, superAdmins);
    if (!allowed.ok) throw badRequest(allowed.message);

    // New staff need an authenticator before they can sign in. The setup link is returned
    // once, to the super admin, who passes it to the person securely. Demoting removes it.
    let mfaSecret = target.mfaSecret;
    let mfaSetupUri: string | undefined;
    if (isStaffRole(role) && !mfaSecret) {
      mfaSecret = authenticator.generateSecret();
      mfaSetupUri = authenticator.keyuri(target.phone, "Cone Admin", mfaSecret);
    }
    if (!isStaffRole(role)) mfaSecret = null;

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: target.id }, data: { role, mfaSecret } });
      await recordAudit(tx, staff.id, "user.role", "user", target.id, { from: target.role, to: role });
      return user;
    });

    // Force a fresh sign-in so the new role (and the authenticator step) applies immediately.
    await deleteAllSessions(target.id);
    res.json({ ...serializeUser(updated), ...(mfaSetupUri ? { mfaSetupUri } : {}) });
  })
);

// ---------- Categories ----------

const fieldsInput = z.array(z.unknown()).max(20);

const categoryCreate = z.object({
  name: z.string().trim().min(1).max(60),
  parentId: z.string().min(1).nullable().optional(),
  order: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
  fields: fieldsInput.optional(),
});

const categoryPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  order: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
  fields: fieldsInput.optional(),
});

function serializeCategoryRow(c: {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  order: number;
  active: boolean;
  fields: unknown;
}) {
  return {
    id: c.id,
    parentId: c.parentId,
    name: c.name,
    slug: c.slug,
    order: c.order,
    active: c.active,
    fields: Array.isArray(c.fields) ? c.fields : [],
    children: [],
  };
}

function checkedFields(input: unknown[] | undefined) {
  const result = validateFieldDefs(input ?? []);
  if (!result.ok) throw badRequest(result.message, { fields: result.message });
  return result.fields;
}

// GET /admin/categories  (flat, includes inactive ones so they can be re-enabled)
adminRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.category.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] });
    res.json({ items: rows.map(serializeCategoryRow) });
  })
);

// POST /admin/categories  (super admin)
adminRouter.post(
  "/categories",
  superAdminOnly,
  asyncHandler(async (req, res) => {
    const staff = req.user!;
    const body = parseBody(categoryCreate, req.body);
    const fields = checkedFields(body.fields);

    if (body.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: body.parentId } });
      if (!parent) throw badRequest("Unknown parent category", { parentId: "Choose an existing category" });
      // Two levels only, and a category that already holds listings cannot become a parent,
      // because listings must always sit in a leaf category.
      if (parent.parentId) throw badRequest("Categories can only be two levels deep", { parentId: "Choose a top-level category" });
      if ((await prisma.listing.count({ where: { categoryId: parent.id } })) > 0) {
        throw badRequest("This category already has listings. Move them before adding subcategories.", {
          parentId: "Category has listings",
        });
      }
    }

    const base = slugify(body.name);
    let slug = base;
    for (let n = 2; await prisma.category.findUnique({ where: { slug } }); n++) {
      if (n > 50) throw badRequest("Could not create a unique slug");
      slug = `${base}-${n}`;
    }

    const created = await prisma.$transaction(async (tx) => {
      const category = await tx.category.create({
        data: {
          name: body.name,
          slug,
          parentId: body.parentId ?? null,
          order: body.order ?? 0,
          active: body.active ?? true,
          fields,
        },
      });
      await recordAudit(tx, staff.id, "category.create", "category", category.id, { name: body.name });
      return category;
    });
    res.status(201).json(serializeCategoryRow(created));
  })
);

// PATCH /admin/categories/:id  (super admin; send only what changes)
adminRouter.patch(
  "/categories/:id",
  superAdminOnly,
  asyncHandler(async (req, res) => {
    const staff = req.user!;
    const body = parseBody(categoryPatch, req.body);
    const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Category not found");

    const data: Prisma.CategoryUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.order !== undefined) data.order = body.order;
    if (body.active !== undefined) data.active = body.active;
    if (body.fields !== undefined) data.fields = checkedFields(body.fields);

    const updated = await prisma.$transaction(async (tx) => {
      const category = await tx.category.update({ where: { id: existing.id }, data });
      await recordAudit(tx, staff.id, "category.update", "category", existing.id, {
        changed: Object.keys(body),
      });
      return category;
    });
    res.json(serializeCategoryRow(updated));
  })
);

// ---------- Areas ----------

// GET /admin/areas  (flat, includes inactive)
adminRouter.get(
  "/areas",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.area.findMany({
      orderBy: { name: "asc" },
      select: { id: true, parentId: true, name: true, active: true },
    });
    res.json({ items: rows });
  })
);

// POST /admin/areas  (super admin)
adminRouter.post(
  "/areas",
  superAdminOnly,
  asyncHandler(async (req, res) => {
    const staff = req.user!;
    const body = parseBody(
      z.object({ name: z.string().trim().min(1).max(60), parentId: z.string().min(1).nullable().optional() }),
      req.body
    );

    if (body.parentId) {
      const parent = await prisma.area.findUnique({ where: { id: body.parentId } });
      if (!parent) throw badRequest("Unknown parent area", { parentId: "Choose an existing sub-city" });
      if (parent.parentId) throw badRequest("Areas can only be two levels deep", { parentId: "Choose a sub-city" });
    }
    const duplicate = await prisma.area.findFirst({
      where: { name: { equals: body.name, mode: "insensitive" }, parentId: body.parentId ?? null },
    });
    if (duplicate) throw badRequest("That area already exists", { name: "Already exists" });

    const created = await prisma.$transaction(async (tx) => {
      const area = await tx.area.create({ data: { name: body.name, parentId: body.parentId ?? null } });
      await recordAudit(tx, staff.id, "area.create", "area", area.id, { name: body.name });
      return area;
    });
    res.status(201).json({ id: created.id, parentId: created.parentId, name: created.name });
  })
);

// PATCH /admin/areas/:id  (super admin; rename or hide)
adminRouter.patch(
  "/areas/:id",
  superAdminOnly,
  asyncHandler(async (req, res) => {
    const staff = req.user!;
    const body = parseBody(
      z.object({ name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() }),
      req.body
    );
    const existing = await prisma.area.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Area not found");

    const updated = await prisma.$transaction(async (tx) => {
      const area = await tx.area.update({ where: { id: existing.id }, data: body });
      await recordAudit(tx, staff.id, "area.update", "area", existing.id, { changed: Object.keys(body) });
      return area;
    });
    res.json({ id: updated.id, parentId: updated.parentId, name: updated.name, active: updated.active });
  })
);

// ---------- Settings (super admin) ----------

const settingsSchema = z.object({
  listingExpiryDays: z.number().int().min(1).max(365),
  maxPhotosPerListing: z.number().int().min(1).max(20),
  maxPhotoMegabytes: z.number().int().min(1).max(10),
});

adminRouter.get(
  "/settings",
  superAdminOnly,
  asyncHandler(async (_req, res) => {
    res.json(await getSettings());
  })
);

adminRouter.put(
  "/settings",
  superAdminOnly,
  asyncHandler(async (req, res) => {
    const staff = req.user!;
    const settings = parseBody(settingsSchema, req.body);
    const before = await getSettings();

    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, staff.id, "settings.update", "settings", "app", { before, after: settings });
    });
    res.json(await saveSettings(settings));
  })
);

// ---------- Audit log (read-only) ----------

adminRouter.get(
  "/audit-log",
  asyncHandler(async (req, res) => {
    const q = parseBody(
      z.object({
        page: pagingShape.page,
        pageSize: z.preprocess(blank, z.coerce.number().int().min(1).max(50).default(50)),
      }),
      req.query
    );
    const [total, rows] = await prisma.$transaction([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: skipOf(q.page, q.pageSize),
        take: q.pageSize,
      }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      details: r.details,
      createdAt: r.createdAt.toISOString(),
    }));
    res.json(pageOf(items, total, q.page, q.pageSize));
  })
);

