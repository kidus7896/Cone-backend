import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { serializeUser } from "../auth/serialize";
import { prisma } from "../db";
import { asyncHandler, badRequest, parseBody } from "../lib/errors";

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
