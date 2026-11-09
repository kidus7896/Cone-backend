import { describe, expect, it } from "vitest";
import { canChangeRole, canSuspend, moderationTransition, slugify, validateFieldDefs } from "../src/admin/rules";
import { phoneSearchDigits } from "../src/lib/phone";

describe("moderationTransition", () => {
  it("approves and rejects only pending listings", () => {
    expect(moderationTransition("pending_review", "approve")).toEqual({ ok: true, status: "active" });
    expect(moderationTransition("pending_review", "reject")).toEqual({ ok: true, status: "rejected" });
    expect(moderationTransition("active", "approve").ok).toBe(false);
    expect(moderationTransition("draft", "reject").ok).toBe(false);
  });
  it("removes live listings but not drafts or rejected ones", () => {
    for (const s of ["active", "paused", "pending_review", "expired", "sold"] as const) {
      expect(moderationTransition(s, "remove")).toEqual({ ok: true, status: "rejected" });
    }
    expect(moderationTransition("draft", "remove").ok).toBe(false);
    expect(moderationTransition("rejected", "remove").ok).toBe(false);
  });
});

describe("canSuspend", () => {
  const mod = { id: "m", role: "moderator" as const };
  const admin = { id: "a", role: "super_admin" as const };
  const user = { id: "u", role: "user" as const };
  it("blocks self, super admins, and moderators suspended by moderators", () => {
    expect(canSuspend(mod, mod).ok).toBe(false);
    expect(canSuspend(admin, { id: "b", role: "super_admin" }).ok).toBe(false);
    expect(canSuspend(mod, { id: "m2", role: "moderator" }).ok).toBe(false);
  });
  it("allows the normal cases", () => {
    expect(canSuspend(mod, user).ok).toBe(true);
    expect(canSuspend(admin, mod).ok).toBe(true);
  });
});

describe("canChangeRole", () => {
  const admin = { id: "a", role: "super_admin" as const };
  it("needs a super admin and not yourself", () => {
    expect(canChangeRole({ id: "m", role: "moderator" }, { id: "u", role: "user" }, "moderator", 1).ok).toBe(false);
    expect(canChangeRole(admin, admin, "user", 2).ok).toBe(false);
  });
  it("keeps at least one super admin", () => {
    expect(canChangeRole(admin, { id: "b", role: "super_admin" }, "user", 1).ok).toBe(false);
    expect(canChangeRole(admin, { id: "b", role: "super_admin" }, "user", 2).ok).toBe(true);
  });
  it("rejects no-op changes and allows promotion", () => {
    expect(canChangeRole(admin, { id: "u", role: "user" }, "user", 1).ok).toBe(false);
    expect(canChangeRole(admin, { id: "u", role: "user" }, "moderator", 1).ok).toBe(true);
  });
});

describe("slugify", () => {
  it("makes url-safe slugs", () => {
    expect(slugify("Home and furniture")).toBe("home-and-furniture");
    expect(slugify("  Phones & Electronics! ")).toBe("phones-electronics");
    expect(slugify("መኪና")).toBe("category");
  });
});

describe("validateFieldDefs", () => {
  it("accepts good fields", () => {
    const r = validateFieldDefs([
      { key: "year", label: "Year", type: "number", required: true },
      { key: "fuel", label: "Fuel", type: "select", options: ["Petrol", "Diesel"] },
    ]);
    expect(r.ok).toBe(true);
  });
  it("rejects bad input", () => {
    expect(validateFieldDefs("x").ok).toBe(false);
    expect(validateFieldDefs([{ key: "Bad Key", label: "x", type: "text" }]).ok).toBe(false);
    expect(validateFieldDefs([{ key: "a", label: "A", type: "text" }, { key: "a", label: "B", type: "text" }]).ok).toBe(false);
    expect(validateFieldDefs([{ key: "a", label: "A", type: "select" }]).ok).toBe(false);
    expect(validateFieldDefs([{ key: "a", label: "A", type: "select", options: ["x", "x"] }]).ok).toBe(false);
    expect(validateFieldDefs([{ key: "a", label: "A", type: "text", options: ["x"] }]).ok).toBe(false);
    expect(validateFieldDefs([{ key: "a", label: "A", type: "color" }]).ok).toBe(false);
  });
});

describe("phoneSearchDigits", () => {
  it("strips prefixes and needs 3+ digits", () => {
    expect(phoneSearchDigits("0912")).toBe("912");
    expect(phoneSearchDigits("+251 91 23")).toBe("9123");
    expect(phoneSearchDigits("09")).toBeNull();
    expect(phoneSearchDigits("abc")).toBeNull();
  });
});
