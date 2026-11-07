// Ethiopian mobile numbers: 09XXXXXXXX (Ethio Telecom) and 07XXXXXXXX (Safaricom Ethiopia).
// Accepted inputs: 0912345678, 912345678, 251912345678, +251912345678
// (spaces and dashes are ignored). Output is always +251XXXXXXXXX, or null if invalid.
export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, "");
  const match = /^(?:\+251|251|0)?([79]\d{8})$/.exec(cleaned);
  return match ? `+251${match[1]}` : null;
}
