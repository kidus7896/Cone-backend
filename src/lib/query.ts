import { z } from "zod";

// Browsers and forms often send empty strings for unset filters; treat them as "not set".
export const blank = (value: unknown) => (value === "" ? undefined : value);

export const optInt = (min: number, max: number) =>
  z.preprocess(blank, z.coerce.number().int().min(min).max(max).optional());

export const pagingShape = {
  page: z.preprocess(blank, z.coerce.number().int().min(1).max(1000).default(1)),
  pageSize: z.preprocess(blank, z.coerce.number().int().min(1).max(50).default(24)),
};

export function pageOf<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, page, pageSize, total };
}

export function skipOf(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
