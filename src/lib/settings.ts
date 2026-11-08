import { prisma } from "../db";

// Matches the Settings schema in openapi.yaml. Stored as one JSON row (key "app").
export interface AppSettings {
  listingExpiryDays: number;
  maxPhotosPerListing: number;
  maxPhotoMegabytes: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  listingExpiryDays: 30,
  maxPhotosPerListing: 8,
  maxPhotoMegabytes: 5,
};

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.setting.findUnique({ where: { key: "app" } });
  const stored = (row?.value ?? {}) as Partial<AppSettings>;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  await prisma.setting.upsert({
    where: { key: "app" },
    update: { value: settings },
    create: { key: "app", value: settings },
  });
  return settings;
}
