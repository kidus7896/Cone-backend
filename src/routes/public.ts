import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler, notFound, parseBody } from "../lib/errors";
import { pageOf, pagingShape, skipOf } from "../lib/query";
import { serializeSummary } from "../listings/serialize";
import { activeListingCount, publicWhere } from "../listings/service";

export const publicRouter = Router();

async function findActiveSeller(id: string) {
  const user = await prisma.user.findFirst({ where: { id, status: "active" } });
  if (!user) throw notFound("Seller not found");
  return user;
}

// GET /sellers/:id  (never includes the phone number)
publicRouter.get(
  "/sellers/:id",
  asyncHandler(async (req, res) => {
    const seller = await findActiveSeller(req.params.id);
    res.json({
      id: seller.id,
      name: seller.name,
      memberSince: seller.createdAt.toISOString(),
      activeListings: await activeListingCount(seller.id),
    });
  })
);

// GET /sellers/:id/listings
publicRouter.get(
  "/sellers/:id/listings",
  asyncHandler(async (req, res) => {
    const seller = await findActiveSeller(req.params.id);
    const q = parseBody(z.object(pagingShape), req.query);

    const where = { ownerId: seller.id, ...publicWhere() };
    const [total, rows] = await prisma.$transaction([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

// GET /sitemap/listings  (ids and last-modified dates for the frontend's sitemap)
publicRouter.get(
  "/sitemap/listings",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.listing.findMany({
      where: publicWhere(),
      orderBy: { updatedAt: "desc" },
      take: 50_000, // the sitemap protocol's limit per file
      select: { id: true, updatedAt: true },
    });
    res.set("Cache-Control", "public, max-age=600");
    res.json({ items: rows.map((r) => ({ id: r.id, updatedAt: r.updatedAt.toISOString() })) });
  })
);
