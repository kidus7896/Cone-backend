import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/lib/phone";

describe("normalizePhone", () => {
  it.each([
    ["0912345678", "+251912345678"],
    ["912345678", "+251912345678"],
    ["251912345678", "+251912345678"],
    ["+251912345678", "+251912345678"],
    ["0712345678", "+251712345678"],
    ["+251 91 234 5678", "+251912345678"],
    ["091-234-5678", "+251912345678"],
  ])("accepts %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    "",
    "0812345678", // not a mobile prefix
    "091234567", // too short
    "09123456789", // too long
    "+254712345678", // Kenyan number
    "abc",
    "0912345678; DROP TABLE users",
  ])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
