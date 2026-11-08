import { randomUUID } from "crypto";
import type { Prisma, User } from "@prisma/client";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { prisma } from "../db";
import { AppError, asyncHandler, badRequest, forbidden, notFound, parseBody, tooMany } from "../lib/errors";
import { processImage } from "../lib/images";
import { blank, optInt, pageOf, pagingShape, skipOf } from "../lib/query";
import { getSettings } from "../lib/settings";
import { deleteObjects, putObject } from "../lib/storage";
import { withDescendants } from "../listings/categories";
import {
  canEdit,
  canSubmit,
  cleanAttributes,
  normalizeTelegram,
  ownerTransition,
  statusAfterEdit,
  submitErrors,
} from "../listings/rules";
import { serializeImage, serializeListing, serializeSummary } from "../listings/serialize";
import {
  ListingFull,
  activeListingCount,
  assertArea,
  canView,
  getOwned,
  isPublic,
  loadLeafCategory,
  loadListing,
  publicWhere,
} from "../listings/service";

export const listingsRouter = Router();

const MAX_NEW_LISTINGS_PER_DAY = 20;
const HARD_UPLOAD_LIMIT_BYTES = 12 * 1024 * 1024;

// ---------- Input schemas ----------

const emptyToNull = (value: unknown) => (value === "" ? null : value);

const contactInput = z.object({
  showPhone: z.boolean().optional(),
  telegram: z.string().trim().max(120).nullable().optional(),
  email: z.preprocess(emptyToNull, z.string().trim().email().max(120).nullable().optional()),
});

const f = {
  title: z.string().trim().min(1).max(120),
  description: z.string().max(5000),
  priceEtb: z.number().int().min(0).max(2_000_000_000),
  negotiable: z.boolean(),
  condition: z.enum(["new", "used"]),
  categoryId: z.string().min(1),
  areaId: z.string().min(1),
  attributes: z.record(z.unknown()),
  contact: contactInput,
};

// A draft needs a title, category and area so it can be stored; everything else can come later.
const createSchema = z.object({
  title: f.title,
  categoryId: f.categoryId,
  areaId: f.areaId,
  description: f.description.optional(),
  priceEtb: f.priceEtb.optional(),
  negotiable: f.negotiable.optional(),
  condition: f.condition.optional(),
  attributes: f.attributes.optional(),
  contact: f.contact.optional(),
});

const patchSchema = z.object({
  title: f.title.optional(),
  categoryId: f.categoryId.optional(),
  areaId: f.areaId.optional(),
  description: f.description.optional(),
  priceEtb: f.priceEtb.optional(),
  negotiable: f.negotiable.optional(),
  condition: f.condition.optional(),
  attributes: f.attributes.optional(),
  contact: f.contact.optional(),
});

const searchSchema = z.object({
  q: z.preprocess(blank, z.string().trim().max(100).optional()),
  categoryId: z.preprocess(blank, z.string().optional()),
  areaId: z.preprocess(blank, z.string().optional()),
  minPrice: optInt(0, 2_000_000_000),
  maxPrice: optInt(0, 2_000_000_000),
  condition: z.preprocess(blank, z.enum(["new", "used"]).optional()),
  postedWithinDays: optInt(1, 365),
  sort: z.preprocess(blank, z.enum(["relevance", "newest", "price_asc", "price_desc"]).default("newest")),
  ...pagingShape,
});

// ---------- Helpers ----------

function assertActiveUser(user: User) {
  if (user.status !== "active") throw forbidden("This account cannot post listings");
}

interface ContactState {
  showPhone: boolean;
  telegram: string | null;
  contactEmail: string | null;
}

function resolveContact(
  input: z.infer<typeof contactInput> | undefined,
  current: ContactState
): { value: ContactState; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const value = { ...current };

  if (input?.showPhone !== undefined) value.showPhone = input.showPhone;

  if (input?.telegram !== undefined) {
    if (input.telegram === null || input.telegram === "") {
      value.telegram = null;
    } else {
      const username = normalizeTelegram(input.telegram);
      if (username) value.telegram = username;
      else errors["contact.telegram"] = "Enter a valid Telegram username";
    }
  }
  if (input?.email !== undefined) value.contactEmail = input.email ?? null;

  return { value, errors };
}

async function present(listing: ListingFull, viewer?: User) {
  const [activeListings, favorite] = await Promise.all([
    activeListingCount(listing.ownerId),
    viewer
      ? prisma.favorite.findUnique({
          where: { userId_listingId: { userId: viewer.id, listingId: listing.id } },
        })
      : Promise.resolve(null),
  ]);
  return serializeListing(listing, listing.owner, { activeListings, isFavorite: favorite !== null });
}

function failIfAny(errors: Record<string, string>) {
  if (Object.keys(errors).length > 0) throw badRequest("Some fields are invalid", errors);
}

// ---------- GET /listings (search and browse) ----------

listingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseBody(searchSchema, req.query);
    const now = new Date();
    const and: Prisma.ListingWhereInput[] = [publicWhere(now)];

    // Searching a parent category (or a sub-city) includes everything beneath it.
    if (q.categoryId) {
      const rows = await prisma.category.findMany({ select: { id: true, parentId: true } });
      and.push({ categoryId: { in: withDescendants(q.categoryId, rows) } });
    }
    if (q.areaId) {
      const rows = await prisma.area.findMany({ select: { id: true, parentId: true } });
      and.push({ areaId: { in: withDescendants(q.areaId, rows) } });
    }
    if (q.minPrice !== undefined || q.maxPrice !== undefined) {
      and.push({ priceEtb: { gte: q.minPrice, lte: q.maxPrice } });
    }
    if (q.condition) and.push({ condition: q.condition });
    if (q.postedWithinDays) {
      and.push({ createdAt: { gte: new Date(now.getTime() - q.postedWithinDays * 86_400_000) } });
    }
    // Every word must appear in the title or description.
    if (q.q) {
      for (const word of q.q.split(/\s+/).filter(Boolean).slice(0, 5)) {
        and.push({
          OR: [
            { title: { contains: word, mode: "insensitive" } },
            { description: { contains: word, mode: "insensitive" } },
          ],
        });
      }
    }

    // "relevance" currently falls back to newest; real ranking comes with full-text search.
    const orderBy: Prisma.ListingOrderByWithRelationInput[] =
      q.sort === "price_asc"
        ? [{ priceEtb: "asc" }, { id: "asc" }]
        : q.sort === "price_desc"
          ? [{ priceEtb: "desc" }, { id: "desc" }]
          : [{ createdAt: "desc" }, { id: "desc" }];

    const where: Prisma.ListingWhereInput = { AND: and };
    const [total, rows] = await prisma.$transaction([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        orderBy,
        skip: skipOf(q.page, q.pageSize),
        take: q.pageSize,
        include: {
          images: { orderBy: { order: "asc" }, take: 1 },
          area: { select: { name: true } },
        },
      }),
    ]);

    res.json(pageOf(rows.map(serializeSummary), total, q.page, q.pageSize));
  })
);

// ---------- POST /listings (create a draft) ----------

listingsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    assertActiveUser(user);
    const body = parseBody(createSchema, req.body);

    const recent = await prisma.listing.count({
      where: { ownerId: user.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
    });
    if (recent >= MAX_NEW_LISTINGS_PER_DAY) {
      throw tooMany("You have created too many listings today. Try again tomorrow.");
    }

    const category = await loadLeafCategory(body.categoryId);
    await assertArea(body.areaId);

    const attrs = cleanAttributes(category.fields, body.attributes ?? {}, false);
    const contact = resolveContact(body.contact, { showPhone: true, telegram: null, contactEmail: null });
    failIfAny({ ...attrs.errors, ...contact.errors });

    const listing = await prisma.listing.create({
      data: {
        ownerId: user.id,
        categoryId: category.id,
        areaId: body.areaId,
        title: body.title,
        description: body.description ?? "",
        priceEtb: body.priceEtb ?? 0,
        negotiable: body.negotiable ?? false,
        condition: body.condition ?? "used",
        attributes: attrs.values,
        showPhone: contact.value.showPhone,
        telegram: contact.value.telegram,
        contactEmail: contact.value.contactEmail,
      },
      include: { images: { orderBy: { order: "asc" } }, owner: true },
    });

    res.status(201).json(await present(listing, user));
  })
);

// ---------- GET /listings/:id ----------

listingsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const listing = await loadListing(req.params.id);
    if (!listing || !canView(listing, req.user)) throw notFound("Listing not found");
    res.json(await present(listing, req.user));
  })
);

// ---------- PATCH /listings/:id ----------

listingsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    assertActiveUser(user);
    const listing = await getOwned(req.params.id, user);
    if (!canEdit(listing.status)) throw badRequest("A sold listing cannot be edited");

    const body = parseBody(patchSchema, req.body);
    const category = await loadLeafCategory(body.categoryId ?? listing.categoryId);
    if (body.areaId) await assertArea(body.areaId);

    const nextStatus = statusAfterEdit(listing.status);
    // Anything that will be (or already is) in the review queue must be complete.
    const needsComplete = nextStatus === "pending_review";

    const attrs = cleanAttributes(
      category.fields,
      body.attributes ?? (listing.attributes as Record<string, unknown>),
      needsComplete
    );
    const contact = resolveContact(body.contact, {
      showPhone: listing.showPhone,
      telegram: listing.telegram,
      contactEmail: listing.contactEmail,
    });

    const title = body.title ?? listing.title;
    const description = body.description ?? listing.description;
    const priceEtb = body.priceEtb ?? listing.priceEtb;

    const errors = needsComplete
      ? {
          ...contact.errors,
          ...submitErrors({
            title,
            description,
            priceEtb,
            imageCount: listing.images.length,
            showPhone: contact.value.showPhone,
            telegram: contact.value.telegram,
            contactEmail: contact.value.contactEmail,
            attributeErrors: attrs.errors,
          }),
        }
      : { ...attrs.errors, ...contact.errors };
    failIfAny(errors);

    const updated = await prisma.listing.update({
      where: { id: listing.id },
      data: {
        title,
        description,
        priceEtb,
        categoryId: category.id,
        areaId: body.areaId,
        negotiable: body.negotiable,
        condition: body.condition,
        attributes: attrs.values,
        showPhone: contact.value.showPhone,
        telegram: contact.value.telegram,
        contactEmail: contact.value.contactEmail,
        status: nextStatus,
        rejectReason: nextStatus === "pending_review" ? null : undefined,
      },
      include: { images: { orderBy: { order: "asc" } }, owner: true },
    });

    res.json(await present(updated, user));
  })
);

// ---------- DELETE /listings/:id ----------

listingsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const listing = await getOwned(req.params.id, req.user!);
    await prisma.listing.delete({ where: { id: listing.id } });
    await deleteObjects(listing.images.flatMap((i) => [i.storageKey, i.thumbKey]));
    res.status(204).end();
  })
);

// ---------- POST /listings/:id/submit ----------

listingsRouter.post(
  "/:id/submit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    assertActiveUser(user);
    const listing = await getOwned(req.params.id, user);
    if (!canSubmit(listing.status)) {
      throw badRequest("Only a draft or rejected listing can be submitted for review");
    }

    const category = await loadLeafCategory(listing.categoryId);
    const attrs = cleanAttributes(category.fields, listing.attributes as Record<string, unknown>, true);
    failIfAny(
      submitErrors({
        title: listing.title,
        description: listing.description,
        priceEtb: listing.priceEtb,
        imageCount: listing.images.length,
        showPhone: listing.showPhone,
        telegram: listing.telegram,
        contactEmail: listing.contactEmail,
        attributeErrors: attrs.errors,
      })
    );

    const updated = await prisma.listing.update({
      where: { id: listing.id },
      data: { status: "pending_review", rejectReason: null },
      include: { images: { orderBy: { order: "asc" } }, owner: true },
    });
    res.json(await present(updated, user));
  })
);

// ---------- POST /listings/:id/status (pause, resume, mark sold, renew) ----------

listingsRouter.post(
  "/:id/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    assertActiveUser(user);
    const { action } = parseBody(
      z.object({ action: z.enum(["pause", "resume", "mark_sold", "renew"]) }),
      req.body
    );
    const listing = await getOwned(req.params.id, user);

    const now = new Date();
    const result = ownerTransition(listing.status, action, listing.expiresAt, now);
    if (!result.ok) throw badRequest(result.message);

    const settings = await getSettings();
    const updated = await prisma.listing.update({
      where: { id: listing.id },
      data: {
        status: result.status,
        expiresAt: result.resetExpiry
          ? new Date(now.getTime() + settings.listingExpiryDays * 86_400_000)
          : undefined,
      },
      include: { images: { orderBy: { order: "asc" } }, owner: true },
    });
    res.json(await present(updated, user));
  })
);

// ---------- Favorites ----------

const MAX_FAVORITES = 500;

// PUT /listings/:id/favorite
listingsRouter.put(
  "/:id/favorite",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const listing = await loadListing(req.params.id);
    if (!listing || !isPublic(listing)) throw notFound("Listing not found");

    const key = { userId_listingId: { userId: user.id, listingId: listing.id } };
    const already = await prisma.favorite.findUnique({ where: key });
    if (!already) {
      if ((await prisma.favorite.count({ where: { userId: user.id } })) >= MAX_FAVORITES) {
        throw badRequest(`You can save up to ${MAX_FAVORITES} favorites`);
      }
      await prisma.favorite.create({ data: { userId: user.id, listingId: listing.id } });
    }
    res.status(204).end();
  })
);

// DELETE /listings/:id/favorite
listingsRouter.delete(
  "/:id/favorite",
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.favorite.deleteMany({ where: { userId: req.user!.id, listingId: req.params.id } });
    res.status(204).end();
  })
);

// ---------- Reports ----------

const MAX_REPORTS_PER_DAY = 20;

const reportSchema = z.object({
  reason: z.enum(["scam", "fake", "prohibited_item", "wrong_category", "duplicate", "other"]),
  note: z.string().trim().max(500).optional(),
});

// POST /listings/:id/report
listingsRouter.post(
  "/:id/report",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = parseBody(reportSchema, req.body);

    const listing = await loadListing(req.params.id);
    if (!listing || !canView(listing, user)) throw notFound("Listing not found");
    if (listing.ownerId === user.id) throw badRequest("You cannot report your own listing");

    // Reporting the same listing twice while the first report is open changes nothing.
    const duplicate = await prisma.report.findFirst({
      where: { listingId: listing.id, reporterId: user.id, status: "open" },
    });
    if (!duplicate) {
      const today = await prisma.report.count({
        where: { reporterId: user.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
      });
      if (today >= MAX_REPORTS_PER_DAY) throw tooMany("You have sent too many reports today.");

      await prisma.report.create({
        data: {
          listingId: listing.id,
          reportedUserId: listing.ownerId,
          reporterId: user.id,
          reason: body.reason,
          note: body.note || null,
        },
      });
    }
    res.status(201).end();
  })
);

// ---------- Phone reveal ----------

const limitHandler = (_req: Request, res: Response) => {
  res.status(429).json({
    error: { code: "rate_limited", message: "Too many phone number requests. Try again later.", fields: {} },
  });
};

// Many Ethiopian mobile users share one public IP (carrier-grade NAT), so the per-IP limit
// is generous and the per-device limit does the real work. The frontend should send a
// random, stored X-Device-Id header; without it the IP is used as the device key.
const revealIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
});

const revealDeviceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => {
    const id = req.header("x-device-id");
    return id && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? `d:${id}` : `ip:${req.ip}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
});

// POST /listings/:id/phone
listingsRouter.post(
  "/:id/phone",
  revealIpLimiter,
  revealDeviceLimiter,
  asyncHandler(async (req, res) => {
    const listing = await loadListing(req.params.id);
    if (!listing || !isPublic(listing)) throw notFound("Listing not found");
    if (!listing.showPhone) throw forbidden("This seller prefers other ways of contact");
    res.set("Cache-Control", "no-store");
    res.json({ phone: listing.owner.phone });
  })
);

// ---------- Photos ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_UPLOAD_LIMIT_BYTES, files: 1 },
});

function acceptUpload(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "Photo is too large" : "Invalid upload";
      return next(badRequest("Upload failed", { file: message }));
    }
    next(err);
  });
}

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.user?.id ?? "anonymous",
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: "rate_limited", message: "Too many uploads. Try again later.", fields: {} },
    });
  },
});

// POST /listings/:id/images
listingsRouter.post(
  "/:id/images",
  requireAuth,
  uploadLimiter,
  acceptUpload,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    assertActiveUser(user);
    const listing = await getOwned(req.params.id, user);
    if (!canEdit(listing.status)) throw badRequest("A sold listing cannot be edited");

    const file = req.file;
    if (!file) throw badRequest("No photo received", { file: "Choose a photo to upload" });

    const settings = await getSettings();
    if (file.size > settings.maxPhotoMegabytes * 1024 * 1024) {
      throw badRequest("Photo is too large", {
        file: `Photos can be up to ${settings.maxPhotoMegabytes} MB`,
      });
    }
    if (listing.images.length >= settings.maxPhotosPerListing) {
      throw badRequest("Too many photos", {
        photos: `You can add up to ${settings.maxPhotosPerListing} photos`,
      });
    }

    const processed = await processImage(file.buffer);
    const id = randomUUID();
    const storageKey = `listings/${listing.id}/${id}.webp`;
    const thumbKey = `listings/${listing.id}/${id}_thumb.webp`;

    try {
      await Promise.all([
        putObject(storageKey, processed.full, "image/webp"),
        putObject(thumbKey, processed.thumb, "image/webp"),
      ]);
    } catch (err) {
      await deleteObjects([storageKey, thumbKey]);
      if (err instanceof AppError) throw err;
      throw new AppError(502, "storage_error", "Could not store the photo. Please try again.");
    }

    const last = await prisma.listingImage.findFirst({
      where: { listingId: listing.id },
      orderBy: { order: "desc" },
    });
    const image = await prisma.listingImage.create({
      data: {
        id,
        listingId: listing.id,
        storageKey,
        thumbKey,
        order: (last?.order ?? -1) + 1,
        sizeBytes: processed.bytes,
      },
    });

    // New photos on approved content go back through moderation.
    const nextStatus = statusAfterEdit(listing.status);
    if (nextStatus !== listing.status) {
      await prisma.listing.update({ where: { id: listing.id }, data: { status: nextStatus, rejectReason: null } });
    }

    res.status(201).json(serializeImage(image));
  })
);

// PUT /listings/:id/images/order  (first image is the cover)
listingsRouter.put(
  "/:id/images/order",
  requireAuth,
  asyncHandler(async (req, res) => {
    const listing = await getOwned(req.params.id, req.user!);
    const { imageIds } = parseBody(z.object({ imageIds: z.array(z.string()).max(50) }), req.body);

    const current = new Set(listing.images.map((i) => i.id));
    const requested = new Set(imageIds);
    if (imageIds.length !== current.size || requested.size !== current.size || ![...requested].every((id) => current.has(id))) {
      throw badRequest("The list must contain every photo of this listing exactly once", {
        imageIds: "Send all photo ids of this listing",
      });
    }

    await prisma.$transaction(
      imageIds.map((id, index) => prisma.listingImage.update({ where: { id }, data: { order: index } }))
    );
    res.status(204).end();
  })
);

// DELETE /listings/:id/images/:imageId
listingsRouter.delete(
  "/:id/images/:imageId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const listing = await getOwned(req.params.id, req.user!);
    if (!canEdit(listing.status)) throw badRequest("A sold listing cannot be edited");

    const image = listing.images.find((i) => i.id === req.params.imageId);
    if (!image) throw notFound("Photo not found");

    const isEarlyStage = listing.status === "draft" || listing.status === "rejected";
    if (listing.images.length === 1 && !isEarlyStage) {
      throw badRequest("A listing needs at least one photo", { photos: "Add another photo before removing this one" });
    }

    await prisma.listingImage.delete({ where: { id: image.id } });
    await deleteObjects([image.storageKey, image.thumbKey]);
    res.status(204).end();
  })
);
