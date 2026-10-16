/** Client-side validation mirrors the server's India defaults for fast feedback.
 * The server remains the authority: every rule is re-validated by FastAPI. */
import { z } from "zod";

export const normalizePhone = (raw: string): string => {
  let s = raw.trim().replace(/[^\d+]/g, "");
  if (s.startsWith("+91")) s = s.slice(3);
  else if (s.startsWith("+")) return s;
  else if (s.startsWith("0091")) s = s.slice(4);
  else if (s.length === 12 && s.startsWith("91")) s = s.slice(2);
  if (s.length === 11 && s.startsWith("0")) s = s.slice(1);
  return s;
};

export const mobileSchema = z
  .string()
  .trim()
  .min(1, "Mobile is required")
  .refine((v) => {
    const n = normalizePhone(v);
    return n.startsWith("+") ? /^\+[1-9]\d{6,14}$/.test(n) : /^[6-9]\d{9}$/.test(n);
  }, "Enter a 10-digit Indian mobile or +<country code><number>");

export const optionalMobile = z.union([z.literal(""), mobileSchema]).optional();
export const panSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN must look like AAAAA9999A");
export const pinSchema = z.string().trim().regex(/^[1-9]\d{5}$/, "PIN code must be 6 digits");
export const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with up to 2 decimals");

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function verhoeffValid(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let c = 0;
  num.split("").reverse().forEach((ch, i) => {
    c = D[c]![P[i % 8]![Number(ch)]!]!;
  });
  return c === 0;
}
export const aadhaarSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .refine((v) => /^[2-9]\d{11}$/.test(v) && verhoeffValid(v), "Invalid Aadhaar number (checksum)");

export function isAdult(dob: string, minAge = 18): boolean {
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= minAge;
}
