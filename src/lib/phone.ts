// Ethiopian mobile numbers: 09XXXXXXXX (Ethio Telecom) and 07XXXXXXXX (Safaricom Ethiopia).
// Accepted inputs: 0912345678, 912345678, 251912345678, +251912345678
// (spaces and dashes are ignored). Output is always +251XXXXXXXXX, or null if invalid.
// For admin user search: turns what a moderator typed ("0912", "+251 91 23") into the digits
// to look for inside stored +251XXXXXXXXX numbers. Returns null if too short to search.
export function phoneSearchDigits(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("251")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length >= 3 ? digits : null;
}

export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, "");
  const match = /^(?:\+251|251|0)?([79]\d{8})$/.exec(cleaned);
  return match ? `+251${match[1]}` : null;
}
