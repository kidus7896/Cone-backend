import { describe, expect, it } from "vitest";
import {
  hashOtp,
  hashToken,
  randomCode,
  randomToken,
  safeEqual,
  signMfaToken,
  verifyMfaToken,
} from "../src/lib/crypto";

const SECRET = "test-secret-test-secret-test-secret-123";

describe("randomCode", () => {
  it("is always 6 digits", () => {
    for (let i = 0; i < 200; i++) expect(randomCode(6)).toMatch(/^\d{6}$/);
  });
});

describe("hashing", () => {
  it("is deterministic for the same input", () => {
    expect(hashOtp(SECRET, "+251912345678", "123456")).toBe(hashOtp(SECRET, "+251912345678", "123456"));
  });
  it("differs by phone, code and secret", () => {
    const base = hashOtp(SECRET, "+251912345678", "123456");
    expect(hashOtp(SECRET, "+251912345679", "123456")).not.toBe(base);
    expect(hashOtp(SECRET, "+251912345678", "123457")).not.toBe(base);
    expect(hashOtp("another-secret-another-secret-12345", "+251912345678", "123456")).not.toBe(base);
  });
  it("keeps OTP and session hashes in separate domains", () => {
    expect(hashToken(SECRET, "abc")).not.toBe(hashOtp(SECRET, "abc", ""));
  });
  it("generates unique tokens", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe("safeEqual", () => {
  it("compares strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("mfa token", () => {
  it("round-trips a user id", () => {
    const token = signMfaToken(SECRET, "user123");
    expect(verifyMfaToken(SECRET, token)).toBe("user123");
  });
  it("rejects expired tokens", () => {
    const token = signMfaToken(SECRET, "user123", 1000, 0);
    expect(verifyMfaToken(SECRET, token, 5000)).toBeNull();
  });
  it("rejects tampering and wrong secrets", () => {
    const token = signMfaToken(SECRET, "user123");
    const [, exp, sig] = token.split(".");
    expect(verifyMfaToken(SECRET, `other.${exp}.${sig}`)).toBeNull();
    expect(verifyMfaToken("a-different-secret-a-different-secret", token)).toBeNull();
    expect(verifyMfaToken(SECRET, "garbage")).toBeNull();
  });
});
