import type { Listing, ListingImage, Prisma, User } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, forbidden, notFound } from "../lib/errors";
import type { FieldDef } from "./rules";

export type ListingFull = Listing & { images: ListingImage[]; owner: User };

// Rows a stranger is allowed to see: approved, not expired, and the owner is in good standing.
export function publicWhere(now = new Date()): Prisma.ListingWhereInput {
  return {
    status: "active",
    owner: { status: "active" },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

export function isPublic(listing: ListingFull, now = new Date()): boolean {
  return (
    listing.status === "active" &&
    listing.owner.status === "active" &&
    (!listing.expiresAt || listing.expiresAt > now)
  );
}

export function isStaff(user: User | undefined): boolean {
  return user?.role === "moderator" || user?.role === "super_admin";
}

export async function loadListing(id: string): Promise<ListingFull | null> {
  return prisma.listing.findUnique({
    where: { id },
    include: { images: { orderBy: { order: "asc" } }, owner: true },
  });
}

// Anyone can see a public listing. Otherwise only the owner and staff can.
export function canView(listing: ListingFull, user: User | undefined): boolean {
  if (isPublic(listing)) return true;
  if (!user) return false;
  return user.id === listing.ownerId || isStaff(user);
}

// For owner-only actions. Hidden listings answer 404 so their existence is not revealed.
export async function getOwned(id: string, user: User): Promise<ListingFull> {
  const listing = await loadListing(id);
  if (!listing) throw notFound("Listing not found");
  if (listing.ownerId !== user.id) {
    throw canView(listing, user) ? forbidden("This is not your listing") : notFound("Listing not found");
  }
  return listing;
}

// Listings must use a leaf category (one with no subcategories).
export async function loadLeafCategory(categoryId: string): Promise<{ id: string; fields: FieldDef[] }> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, active: true },
    include: { _count: { select: { children: true } } },
  });
  if (!category) throw badRequest("Unknown category", { categoryId: "Choose a valid category" });
  if (category._count.children > 0) {
    throw badRequest("Choose a more specific category", { categoryId: "Choose a subcategory" });
  }
  return {
    id: category.id,
    fields: Array.isArray(category.fields) ? (category.fields as unknown as FieldDef[]) : [],
  };
}

export async function assertArea(areaId: string): Promise<void> {
  const area = await prisma.area.findFirst({ where: { id: areaId, active: true } });
  if (!area) throw badRequest("Unknown area", { areaId: "Choose a valid area" });
}

export function activeListingCount(ownerId: string): Promise<number> {
  return prisma.listing.count({ where: { ownerId, ...publicWhere() } });
}

// Marks approved listings past their expiry date as expired. Called on a timer from server.ts.
export async function expireListings(now = new Date()): Promise<number> {
  const result = await prisma.listing.updateMany({
    where: { status: { in: ["active", "paused"] }, expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  return result.count;
}
