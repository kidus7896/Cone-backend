import type { Area, Listing, ListingImage, User } from "@prisma/client";
import { publicUrl } from "../lib/storage";

type ListingWithImages = Listing & { images: ListingImage[] };

export function serializeImage(image: ListingImage) {
  return {
    id: image.id,
    url: publicUrl(image.storageKey),
    thumbUrl: publicUrl(image.thumbKey),
    order: image.order,
  };
}

// Compact card used in lists and search results.
export function serializeSummary(listing: ListingWithImages & { area: Pick<Area, "name"> }) {
  const cover = listing.images[0];
  return {
    id: listing.id,
    title: listing.title,
    priceEtb: listing.priceEtb,
    negotiable: listing.negotiable,
    condition: listing.condition,
    areaName: listing.area.name,
    categoryId: listing.categoryId,
    coverThumbUrl: cover ? publicUrl(cover.thumbKey) : null,
    createdAt: listing.createdAt.toISOString(),
  };
}

// Full listing. The seller's phone number is never included here: buyers get it from
// POST /listings/{id}/phone, which is rate limited to make bulk scraping harder.
export function serializeListing(
  listing: ListingWithImages,
  owner: Pick<User, "id" | "name" | "createdAt">,
  extras: { activeListings: number; isFavorite: boolean }
) {
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    priceEtb: listing.priceEtb,
    negotiable: listing.negotiable,
    condition: listing.condition,
    categoryId: listing.categoryId,
    areaId: listing.areaId,
    attributes: listing.attributes,
    images: [...listing.images].sort((a, b) => a.order - b.order).map(serializeImage),
    contact: {
      showPhone: listing.showPhone,
      telegram: listing.telegram,
      email: listing.contactEmail,
    },
    status: listing.status,
    rejectReason: listing.rejectReason,
    seller: {
      id: owner.id,
      name: owner.name,
      memberSince: owner.createdAt.toISOString(),
      activeListings: extras.activeListings,
    },
    isFavorite: extras.isFavorite,
    expiresAt: listing.expiresAt ? listing.expiresAt.toISOString() : null,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
  };
}
