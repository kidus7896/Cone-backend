import { describe, expect, it } from "vitest";
import {
  canEdit,
  canSubmit,
  cleanAttributes,
  normalizeTelegram,
  ownerTransition,
  statusAfterEdit,
  submitErrors,
} from "../src/listings/rules";
import type { FieldDef, ListingStatus } from "../src/listings/rules";

const NOW = new Date("2026-11-08T12:00:00Z");
const FUTURE = new Date("2026-12-01T00:00:00Z");
const PAST = new Date("2026-10-01T00:00:00Z");

describe("statusAfterEdit", () => {
  it("sends approved content back to review", () => {
    expect(statusAfterEdit("active")).toBe("pending_review");
    expect(statusAfterEdit("paused")).toBe("pending_review");
    expect(statusAfterEdit("expired")).toBe("pending_review");
  });
  it("leaves early-stage listings alone", () => {
    expect(statusAfterEdit("draft")).toBe("draft");
    expect(statusAfterEdit("rejected")).toBe("rejected");
    expect(statusAfterEdit("pending_review")).toBe("pending_review");
  });
});

describe("canEdit / canSubmit", () => {
  it("blocks edits to sold listings only", () => {
    const all: ListingStatus[] = ["draft", "pending_review", "active", "rejected", "paused", "sold", "expired"];
    expect(all.filter((s) => !canEdit(s))).toEqual(["sold"]);
  });
  it("allows submitting drafts and rejected listings only", () => {
    const all: ListingStatus[] = ["draft", "pending_review", "active", "rejected", "paused", "sold", "expired"];
    expect(all.filter(canSubmit)).toEqual(["draft", "rejected"]);
  });
});

describe("ownerTransition", () => {
  it("pauses only active listings", () => {
    expect(ownerTransition("active", "pause", FUTURE, NOW)).toEqual({ ok: true, status: "paused", resetExpiry: false });
    expect(ownerTransition("draft", "pause", null, NOW).ok).toBe(false);
    expect(ownerTransition("sold", "pause", null, NOW).ok).toBe(false);
  });
  it("resumes a paused listing that has not expired", () => {
    expect(ownerTransition("paused", "resume", FUTURE, NOW)).toEqual({ ok: true, status: "active", resetExpiry: false });
  });
  it("refuses to resume an expired or undated listing", () => {
    expect(ownerTransition("paused", "resume", PAST, NOW).ok).toBe(false);
    expect(ownerTransition("paused", "resume", null, NOW).ok).toBe(false);
    expect(ownerTransition("active", "resume", FUTURE, NOW).ok).toBe(false);
  });
  it("marks active or paused listings as sold", () => {
    expect(ownerTransition("active", "mark_sold", FUTURE, NOW).ok).toBe(true);
    expect(ownerTransition("paused", "mark_sold", FUTURE, NOW).ok).toBe(true);
    expect(ownerTransition("pending_review", "mark_sold", null, NOW).ok).toBe(false);
    expect(ownerTransition("rejected", "mark_sold", null, NOW).ok).toBe(false);
  });
  it("renews active and expired listings with a fresh expiry", () => {
    expect(ownerTransition("expired", "renew", PAST, NOW)).toEqual({ ok: true, status: "active", resetExpiry: true });
    expect(ownerTransition("active", "renew", FUTURE, NOW)).toEqual({ ok: true, status: "active", resetExpiry: true });
    expect(ownerTransition("paused", "renew", FUTURE, NOW).ok).toBe(false);
    expect(ownerTransition("pending_review", "renew", null, NOW).ok).toBe(false);
  });
});

describe("normalizeTelegram", () => {
  it.each([
    ["@cone_support", "cone_support"],
    ["cone_support", "cone_support"],
    ["t.me/cone_support", "cone_support"],
    ["https://t.me/cone_support", "cone_support"],
    ["https://t.me/cone_support/", "cone_support"],
    ["  @Cone_Support  ", "Cone_Support"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeTelegram(input)).toBe(expected);
  });
  it.each(["", "abc", "1abcde", "has space", "bad-char!", "a".repeat(33), "https://evil.example/cone_support"])(
    "rejects %s",
    (input) => {
      expect(normalizeTelegram(input)).toBeNull();
    }
  );
});

const carFields: FieldDef[] = [
  { key: "make", label: "Make", type: "text", required: true },
  { key: "year", label: "Year", type: "number", required: true },
  { key: "fuel", label: "Fuel", type: "select", options: ["Petrol", "Diesel"] },
];

describe("cleanAttributes", () => {
  it("keeps valid values and drops unknown keys", () => {
    const result = cleanAttributes(carFields, { make: " Toyota ", year: 2015, fuel: "Diesel", hacked: "x" }, true);
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ make: "Toyota", year: 2015, fuel: "Diesel" });
  });
  it("does not require required fields for drafts", () => {
    expect(cleanAttributes(carFields, {}, false).errors).toEqual({});
  });
  it("requires required fields when submitting", () => {
    const errors = cleanAttributes(carFields, {}, true).errors;
    expect(Object.keys(errors).sort()).toEqual(["attributes.make", "attributes.year"]);
  });
  it("rejects wrong types and unknown options", () => {
    const errors = cleanAttributes(carFields, { make: 5, year: "2015", fuel: "Water" }, false).errors;
    expect(Object.keys(errors).sort()).toEqual(["attributes.fuel", "attributes.make", "attributes.year"]);
  });
  it("rejects negative and infinite numbers", () => {
    expect(Object.keys(cleanAttributes(carFields, { year: -1 }, false).errors)).toEqual(["attributes.year"]);
    expect(Object.keys(cleanAttributes(carFields, { year: Infinity }, false).errors)).toEqual(["attributes.year"]);
  });
});

const ready = {
  title: "Toyota Corolla 2015",
  description: "Well kept car, one owner, full service history.",
  priceEtb: 1_800_000,
  imageCount: 3,
  showPhone: true,
  telegram: null,
  contactEmail: null,
  attributeErrors: {},
};

describe("submitErrors", () => {
  it("accepts a complete listing", () => {
    expect(submitErrors(ready)).toEqual({});
  });
  it("flags each missing piece", () => {
    const errors = submitErrors({
      ...ready,
      title: "Car",
      description: "short",
      priceEtb: 0,
      imageCount: 0,
      showPhone: false,
    });
    expect(Object.keys(errors).sort()).toEqual(["contact", "description", "photos", "priceEtb", "title"]);
  });
  it("accepts Telegram or email as the only contact method", () => {
    expect(submitErrors({ ...ready, showPhone: false, telegram: "cone_support" })).toEqual({});
    expect(submitErrors({ ...ready, showPhone: false, contactEmail: "a@b.com" })).toEqual({});
  });
  it("passes attribute errors through", () => {
    const errors = submitErrors({ ...ready, attributeErrors: { "attributes.make": "Make is required" } });
    expect(errors["attributes.make"]).toBe("Make is required");
  });
});
