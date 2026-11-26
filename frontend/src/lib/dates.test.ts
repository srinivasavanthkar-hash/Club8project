import {
  addMonths, autoDash, autoDashMonth, columnOf, instantToIst, isoToDisplay, istToInstant, longLabel, monthGrid,
  monthToDisplay, parseDisplay, parseMonthDisplay, parseTime, timeToDisplay, weekdayNames,
} from "./dates";

describe("date entry is always day-month-year", () => {
  it("reads the ways staff type a date", () => {
    for (const t of ["05-03-2027", "5-3-2027", "05/03/2027", "5.3.2027", "05032027", " 05-03-2027 "]) {
      expect(parseDisplay(t)).toEqual({ kind: "ok", iso: "2027-03-05" });
    }
    expect(parseDisplay("2027-03-05")).toEqual({ kind: "ok", iso: "2027-03-05" }); // pasted ISO: year first, unambiguous
    expect(parseDisplay("")).toEqual({ kind: "empty" });
  });

  it("refuses impossible, partial and two-digit-year dates", () => {
    for (const t of ["31-02-2027", "29-02-2027", "00-01-2027", "12-13-2027", "05-03-27", "05-03", "abc", "1-1-1800"]) {
      expect(parseDisplay(t).kind).toBe("invalid");
    }
    expect(parseDisplay("29-02-2028")).toEqual({ kind: "ok", iso: "2028-02-29" }); // leap year
  });

  it("never reads a US-style date month-first", () => {
    expect(parseDisplay("03/05/2027")).toEqual({ kind: "ok", iso: "2027-05-03" }); // 3 May, not 5 March
    expect(parseDisplay("12/31/2027").kind).toBe("invalid"); // month 31 does not exist
  });

  it("shows ISO dates as DD-MM-YYYY", () => {
    expect(isoToDisplay("2027-03-05")).toBe("05-03-2027");
    expect(isoToDisplay("2027-03-05T10:00:00Z")).toBe("05-03-2027");
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay("not a date")).toBe("");
  });

  it("puts the dashes in while digits are typed", () => {
    const typed = (s: string) => [...s].reduce((acc, ch) => autoDash(acc + ch), "");
    expect(typed("05032027")).toBe("05-03-2027");
    expect(typed("05-03-2027")).toBe("05-03-2027"); // the person's own dashes are not doubled
    expect(typed("5-3-2027")).toBe("5-3-2027"); // single-digit parts kept as typed
  });

  it("months are MM-YYYY", () => {
    expect(parseMonthDisplay("03-2027")).toEqual({ kind: "ok", ym: "2027-03" });
    expect(parseMonthDisplay("3/2027")).toEqual({ kind: "ok", ym: "2027-03" });
    expect(parseMonthDisplay("13-2027").kind).toBe("invalid");
    expect(monthToDisplay("2027-03")).toBe("03-2027");
    expect(parseMonthDisplay("2027-03")).toEqual({ kind: "ok", ym: "2027-03" }); // pasted year-month
    expect([..."032027"].reduce((a, c) => autoDashMonth(a + c), "")).toBe("03-2027");
  });
});

describe("calendar", () => {
  it("starts the week on Monday or Sunday", () => {
    expect(weekdayNames("MONDAY")[0]).toBe("Monday");
    expect(weekdayNames("SUNDAY")[0]).toBe("Sunday");
    // 1 March 2027 is a Monday
    expect(columnOf("2027-03-01", "MONDAY")).toBe(0);
    expect(columnOf("2027-03-01", "SUNDAY")).toBe(1);
  });

  it("shows whole weeks covering the month", () => {
    const weeks = monthGrid(2027, 2, "MONDAY"); // February 2027 starts on a Monday and has 28 days
    expect(weeks).toHaveLength(4);
    expect(weeks[0]![0]).toBe("2027-02-01");
    const sunday = monthGrid(2027, 2, "SUNDAY");
    expect(sunday[0]![0]).toBe("2027-01-31");
    expect(sunday.at(-1)!.at(-1)).toBe("2027-03-06");
  });

  it("moves by month without spilling into the next one", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2027-12-15", 1)).toBe("2028-01-15");
    expect(addMonths("2027-01-15", -1)).toBe("2026-12-15");
  });

  it("names days in full for screen readers", () => {
    expect(longLabel("2027-03-05")).toBe("Friday 5 March 2027");
  });
});

describe("times are India time", () => {
  it("reads 24-hour and am/pm times", () => {
    expect(parseTime("16:05")).toBe("16:05");
    expect(parseTime("4:05 pm")).toBe("16:05");
    expect(parseTime("4.05PM")).toBe("16:05");
    expect(parseTime("4 pm")).toBe("16:00");
    expect(parseTime("12:00 am")).toBe("00:00");
    expect(parseTime("12:30 pm")).toBe("12:30");
    expect(parseTime("0930")).toBe("09:30");
    for (const t of ["25:00", "13:00 pm", "4:65", "noon", ""]) expect(parseTime(t)).toBeNull();
  });

  it("shows times the way the app does", () => {
    expect(timeToDisplay("16:05")).toBe("4:05 pm");
    expect(timeToDisplay("00:15")).toBe("12:15 am");
    expect(timeToDisplay("12:00")).toBe("12:00 pm");
  });

  it("a typed time is India time whatever the PC's time zone", () => {
    // 11:00 in India = 05:30 UTC, on a PC in New York as anywhere else (the test runner's zone does not matter)
    expect(istToInstant("2026-11-16T11:00")).toBe("2026-11-16T05:30:00.000Z");
    expect(instantToIst("2026-11-16T05:30:00.000Z")).toBe("2026-11-16T11:00");
    expect(instantToIst("2026-11-15T20:00:00.000Z")).toBe("2026-11-16T01:30"); // already the next day in India
  });
});
