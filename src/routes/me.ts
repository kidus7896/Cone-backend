import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { serializeUser } from "../auth/serialize";
import { prisma } from "../db";
import { asyncHandler, badRequest, parseBody } from "../lib/errors";
import { blank, pageOf, pagingShape, skipOf } from "../lib/query";
import { serializeListing, serializeSummary } from "../listings/serialize";
import { activeListingCount, publicWhere } from "../listings/service";

export const meRouter = Router();

meRouter.use(requireAuth);

// GET /me
meRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(serializeUser(req.user!));
  })
);

// PATCH /me  (name, optional email, area). Role and phone can never be changed here.
meRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          email: z.string().trim().email().max(120).nullable().optional(),
          areaId: z.string().min(1).nullable().optional(),
        })
        .strict(),
      req.body
    );

    if (body.areaId) {
      const area = await prisma.area.findFirst({ where: { id: body.areaId, active: true } });
      if (!area) throw badRequest("Unknown area", { areaId: "Choose a valid area" });
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: body,
    });
    res.json(serializeUser(user));
  })
);

// GET /me/listings  (all statuses, newest edits first)
meRouter.get(
  "/listings",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const q = parseBody(
      z.object({
        status: z.preprocess(
          blank,
          z.enum(["draft", "pending_review", "active", "rejected", "paused", "sold", "expired"]).optional()
        ),
        ...pagingShape,
      }),
      req.query
    );

    const where = { ownerId: user.id, status: q.status };
    const [total, rows, activeListings] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: skipOf(q.page, q.pageSize),
        take: q.pageSize,
        include: { images: { orderBy: { order: "asc" } }, owner: true },
      }),
      activeListingCount(user.id),
    ]);

    const items = rows.map((row) => serializeListing(row, row.owner, { activeListings, isFavorite: false }));
    res.json(pageOf(items, total, q.page, q.pageSize));
  })
);

// GET /me/favorites
meRouter.get(
  "/favorites",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const q = parseBody(z.object(pagingShape), req.query);

    // Only listings that are still public are shown; hidden or sold ones simply drop out.
    const where = { userId: user.id, listing: publicWhere() };
    const [total, rows] = await prisma.$transaction([
      prisma.favorite.count({ where }),
      prisma.favorite.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: skipOf(q.page, q.pageSize),
        take: q.pageSize,
        include: {
          listing: {
            include: {
              images: { orderBy: { order: "asc" }, take: 1 },
              area: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    res.json(pageOf(rows.map((row) => serializeSummary(row.listing)), total, q.page, q.pageSize));
  })
);

// POST /me/deletion-request
meRouter.post(
  "/deletion-request",
  asyncHandler(async (req, res) => {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { status: "deletion_requested" },
    });
    res.status(202).end();
  })
);
