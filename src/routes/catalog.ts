import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../lib/errors";
import { buildCategoryTree } from "../listings/categories";

export const catalogRouter = Router();

// GET /categories  (tree, active only). A listing must use a leaf category.
catalogRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.category.findMany({
      where: { active: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    res.set("Cache-Control", "public, max-age=300");
    res.json({ items: buildCategoryTree(rows) });
  })
);

// GET /areas  (flat list; parentId links neighborhoods to sub-cities)
catalogRouter.get(
  "/areas",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.area.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, parentId: true, name: true },
    });
    res.set("Cache-Control", "public, max-age=300");
    res.json({ items: rows });
  })
);
