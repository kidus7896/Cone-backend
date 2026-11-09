// Pure admin rules: who may do what, and what a moderation action does to a listing.
import type { ListingStatus } from "../listings/rules";

export type Role = "user" | "moderator" | "super_admin";
export type ModerationAction = "approve" | "reject" | "remove";

export type Check = { ok: true } | { ok: false; message: string };

// ---------- Listing moderation ----------

export type ModerationResult = { ok: true; status: ListingStatus } | { ok: false; message: string };

// Removing a live listing marks it "rejected" with a reason, so the seller can see why
// and fix and resubmit it.
export function moderationTransition(status: ListingStatus, action: ModerationAction): ModerationResult {
  switch (action) {
    case "approve":
      return status === "pending_review"
        ? { ok: true, status: "active" }
        : { ok: false, message: "Only a listing waiting for review can be approved" };
    case "reject":
      return status === "pending_review"
        ? { ok: true, status: "rejected" }
        : { ok: false, message: "Only a listing waiting for review can be rejected" };
    case "remove":
      return ["active", "paused", "pending_review", "expired", "sold"].includes(status)
        ? { ok: true, status: "rejected" }
        : { ok: false, message: "Drafts and rejected listings cannot be removed" };
  }
}

// ---------- Users and roles ----------

interface Person {
  id: string;
  role: Role;
}

export function canSuspend(actor: Person, target: Person): Check {
  if (actor.id === target.id) return { ok: false, message: "You cannot suspend yourself" };
  if (target.role === "super_admin") return { ok: false, message: "A super admin cannot be suspended" };
  if (target.role === "moderator" && actor.role !== "super_admin") {
    return { ok: false, message: "Only a super admin can suspend a moderator" };
  }
  return { ok: true };
}

export function canChangeRole(actor: Person, target: Person, newRole: Role, superAdminCount: number): Check {
  if (actor.role !== "super_admin") return { ok: false, message: "Only a super admin can change roles" };
  if (actor.id === target.id) return { ok: false, message: "You cannot change your own role" };
  if (target.role === newRole) return { ok: false, message: "This user already has that role" };
  if (target.role === "super_admin" && newRole !== "super_admin" && superAdminCount <= 1) {
    return { ok: false, message: "There must always be at least one super admin" };
  }
  return { ok: true };
}

export const isStaffRole = (role: Role) => role === "moderator" || role === "super_admin";

// ---------- Categories ----------

// "Home and furniture" -> "home-and-furniture". Names with no Latin letters or digits
// (for example Amharic) fall back to "category"; the caller adds a number to keep it unique.
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug || "category";
}

export interface FieldDefInput {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  required?: boolean;
}

export type FieldsResult = { ok: true; fields: FieldDefInput[] } | { ok: false; message: string };

export function validateFieldDefs(input: unknown): FieldsResult {
  const fail = (message: string): FieldsResult => ({ ok: false, message });
  if (!Array.isArray(input)) return fail("Fields must be a list");
  if (input.length > 20) return fail("A category can have at most 20 fields");

  const seen = new Set<string>();
  const fields: FieldDefInput[] = [];

  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return fail("Each field must be an object");
    const f = raw as Record<string, unknown>;

    if (typeof f.key !== "string" || !/^[a-z][a-z0-9_]{0,29}$/.test(f.key)) {
      return fail("Field keys use lowercase letters, digits and underscores, and start with a letter");
    }
    if (seen.has(f.key)) return fail(`Field key "${f.key}" is used twice`);
    seen.add(f.key);

    const label = typeof f.label === "string" ? f.label.trim() : "";
    if (label.length < 1 || label.length > 40) return fail("Field labels must be 1 to 40 characters");

    if (f.type !== "text" && f.type !== "number" && f.type !== "select") {
      return fail("Field type must be text, number or select");
    }
    if (f.required !== undefined && typeof f.required !== "boolean") return fail("required must be true or false");

    const field: FieldDefInput = { key: f.key, label, type: f.type };
    if (f.required === true) field.required = true;

    if (f.type === "select") {
      if (!Array.isArray(f.options) || f.options.length < 1 || f.options.length > 30) {
        return fail("A select field needs 1 to 30 options");
      }
      const options = f.options.map((o) => (typeof o === "string" ? o.trim() : ""));
      if (options.some((o) => o.length < 1 || o.length > 40) || new Set(options).size !== options.length) {
        return fail("Options must be unique and 1 to 40 characters");
      }
      field.options = options;
    } else if (Array.isArray(f.options) && f.options.length > 0) {
      return fail("Only select fields can have options");
    }
    fields.push(field);
  }
  return { ok: true, fields };
}
