// Pure listing rules: no database, no imports. Easy to test and reason about.

export type ListingStatus =
  | "draft"
  | "pending_review"
  | "active"
  | "rejected"
  | "paused"
  | "sold"
  | "expired";

export type OwnerAction = "pause" | "resume" | "mark_sold" | "renew";

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  required?: boolean;
}

// ---------- Status rules ----------

export function canEdit(status: ListingStatus): boolean {
  return status !== "sold";
}

// Editing approved content sends it back to moderation, so a seller cannot swap in
// prohibited content after approval. Drafts and rejected listings stay as they are
// until the seller submits them.
export function statusAfterEdit(status: ListingStatus): ListingStatus {
  if (status === "active" || status === "paused" || status === "expired") return "pending_review";
  return status;
}

export type TransitionResult =
  | { ok: true; status: ListingStatus; resetExpiry: boolean }
  | { ok: false; message: string };

export function ownerTransition(
  status: ListingStatus,
  action: OwnerAction,
  expiresAt: Date | null,
  now: Date
): TransitionResult {
  const fail = (message: string): TransitionResult => ({ ok: false, message });
  switch (action) {
    case "pause":
      return status === "active"
        ? { ok: true, status: "paused", resetExpiry: false }
        : fail("Only an active listing can be paused");
    case "resume":
      if (status !== "paused") return fail("Only a paused listing can be resumed");
      if (!expiresAt || expiresAt <= now) return fail("This listing has expired. Renew it instead");
      return { ok: true, status: "active", resetExpiry: false };
    case "mark_sold":
      return status === "active" || status === "paused"
        ? { ok: true, status: "sold", resetExpiry: false }
        : fail("Only an active or paused listing can be marked as sold");
    case "renew":
      // Content is unchanged since approval, so renewing does not need a new review.
      return status === "active" || status === "expired"
        ? { ok: true, status: "active", resetExpiry: true }
        : fail("Only an active or expired listing can be renewed");
  }
}

export function canSubmit(status: ListingStatus): boolean {
  return status === "draft" || status === "rejected";
}

// ---------- Telegram ----------

// Accepts "@name", "name", "t.me/name", "https://t.me/name". Returns the username or null.
export function normalizeTelegram(input: string): string | null {
  let value = input.trim();
  value = value.replace(/^https?:\/\/(www\.)?(t|telegram)\.me\//i, "");
  value = value.replace(/^(t|telegram)\.me\//i, "");
  value = value.replace(/^@/, "");
  value = value.replace(/\/+$/, "");
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value) ? value : null;
}

// ---------- Category-specific attributes ----------

export interface AttributeResult {
  values: Record<string, string | number>;
  errors: Record<string, string>;
}

// Keeps only the keys the category defines (unknown keys are dropped) and checks types.
// requireRequired is true when the listing is going to moderation.
export function cleanAttributes(
  fields: FieldDef[],
  input: Record<string, unknown>,
  requireRequired: boolean
): AttributeResult {
  const values: Record<string, string | number> = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const raw = input[field.key];
    const empty = raw === undefined || raw === null || raw === "";
    const path = `attributes.${field.key}`;

    if (empty) {
      if (requireRequired && field.required) errors[path] = `${field.label} is required`;
      continue;
    }

    if (field.type === "number") {
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1_000_000_000) {
        errors[path] = `${field.label} must be a number`;
      } else {
        values[field.key] = raw;
      }
    } else if (field.type === "select") {
      if (typeof raw !== "string" || !(field.options ?? []).includes(raw)) {
        errors[path] = `Choose a valid ${field.label.toLowerCase()}`;
      } else {
        values[field.key] = raw;
      }
    } else {
      if (typeof raw !== "string" || raw.trim().length > 100) {
        errors[path] = `${field.label} must be text up to 100 characters`;
      } else {
        values[field.key] = raw.trim();
      }
    }
  }
  return { values, errors };
}

// ---------- Readiness for moderation ----------

export interface SubmitCheckInput {
  title: string;
  description: string;
  priceEtb: number;
  imageCount: number;
  showPhone: boolean;
  telegram: string | null;
  contactEmail: string | null;
  attributeErrors: Record<string, string>;
}

export function submitErrors(input: SubmitCheckInput): Record<string, string> {
  const errors: Record<string, string> = { ...input.attributeErrors };
  if (input.title.trim().length < 5) errors.title = "Title must be at least 5 characters";
  if (input.title.trim().length > 120) errors.title = "Title must be at most 120 characters";
  if (input.description.trim().length < 20) {
    errors.description = "Description must be at least 20 characters";
  }
  if (!Number.isInteger(input.priceEtb) || input.priceEtb < 1) {
    errors.priceEtb = "Enter a price in ETB";
  }
  if (input.imageCount < 1) errors.photos = "Add at least one photo";
  if (!input.showPhone && !input.telegram && !input.contactEmail) {
    errors.contact = "Choose at least one way for buyers to reach you";
  }
  return errors;
}
