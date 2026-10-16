import { addMoney, formatDate, formatMoney, subMoney } from "./format";
import { aadhaarSchema, isAdult, mobileSchema, normalizePhone, panSchema, verhoeffValid } from "./validation";

describe("formatting", () => {
  it("uses Indian digit grouping for INR", () => {
    expect(formatMoney("255000.00")).toBe("₹2,55,000.00");
    expect(formatMoney("12345678.5")).toBe("₹1,23,45,678.50");
    expect(formatMoney("-15000.00")).toBe("-₹15,000.00");
    expect(formatMoney("999")).toBe("₹999.00");
    expect(formatMoney("1234567.00", "USD")).toBe("$1,234,567.00");
  });
  it("shows dates as DD-MM-YYYY in Asia/Kolkata", () => {
    expect(formatDate("2026-10-15")).toBe("15-10-2026");
    expect(formatDate("2026-10-14T20:00:00Z")).toBe("15-10-2026"); // 01:30 IST next day
  });
  it("adds and subtracts money exactly (no floating point)", () => {
    expect(addMoney("250000.10", "5000.20")).toBe("255000.30");
    expect(subMoney("0.30", "0.10")).toBe("0.20");
    expect(subMoney("100", "100.01")).toBe("-0.01");
  });
});

describe("validation", () => {
  it("normalises Indian phone numbers", () => {
    for (const raw of ["+91 98450 12345", "098450-12345", "919845012345", "0091 9845012345"]) {
      expect(normalizePhone(raw)).toBe("9845012345");
    }
    expect(mobileSchema.safeParse("12345").success).toBe(false);
    expect(mobileSchema.safeParse("+44 20 7946 0000").success).toBe(true);
  });
  it("validates PAN, Aadhaar (Verhoeff) and adulthood", () => {
    expect(panSchema.safeParse("abcde1234f").success).toBe(true);
    expect(panSchema.safeParse("ABCD1234F").success).toBe(false);
    expect(verhoeffValid("234567890124")).toBe(verhoeffValid("234567890124"));
    const valid = ["2", "3", "4", "5", "6", "7", "8", "9", "0", "1", "2"].join("");
    const withCheck = [...Array(10).keys()].map((d) => valid + d).find((n) => verhoeffValid(n))!;
    expect(aadhaarSchema.safeParse(withCheck).success).toBe(true);
    const wrong = withCheck.slice(0, -1) + ((Number(withCheck.slice(-1)) + 1) % 10);
    expect(aadhaarSchema.safeParse(wrong).success).toBe(false);
    expect(isAdult("1990-01-01")).toBe(true);
    expect(isAdult("2020-01-01")).toBe(false);
  });
});
