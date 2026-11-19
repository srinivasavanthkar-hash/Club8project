/**
 * The follow-up clips (docs/DEMO_CLIPS_PROMPT.md): three short videos on the same recorder as the main video.
 * Each clip: a title card, its scenes (one section file each, in out/clip<n>/), the end card. Its data comes from
 * seed-clips.ts on the run's own throwaway database. `npm run record -- --clip <1|2|3|all> [--dry]`.
 */
import fs from "node:fs";
import path from "node:path";
import { apiAs, istToday, monthName } from "./api";
import { clipOutput } from "./assemble";
import { CLIPS, type Scene, type Section, type Shared } from "./scene";
import { entitlementYears, kavyaDates, requireIntactActivityLog, seedClip2, seedClip3, seedKavya } from "./seed-clips";
import type { Stack } from "./stack";

export type ClipDef = {
  slug: string; title: string; answers: string;
  seed: (stack: Stack) => Promise<Shared>;
  sections: Section[];
  /** after the scenes: the numbers on screen add up (throws otherwise) */
  check?: (shared: Shared) => Promise<void>;
};

const card = (title: string): Section[] => [{ id: 0, title: "Title", card: "title.html", cardQuery: `?sub=${encodeURIComponent(title)}`, hold: 4000 }];
const endCard = (id: number): Section => ({ id, title: "End", card: "end.html", hold: 5000 });
const n = (v: string | number | undefined) => Number(v ?? 0);

// ---------------------------------------------------------------- clip 1: reservation rules
type KavyaDates = ReturnType<typeof kavyaDates>;
const fmt = (iso: string) => iso.split("-").reverse().join("-"); // dd-mm-yyyy, as the app shows dates

async function newRequest(s: Scene, b: { check_in: string; check_out: string }): Promise<void> {
  const { page, d } = s;
  await d.click(page.getByRole("button", { name: "New reservation" }));
  await d.select(page.getByLabel("Destination", { exact: true }), "Goa");
  await d.select(page.getByLabel("Property", { exact: true }), "Demo Beach Resort (Premium)");
  await d.fill(page.getByLabel("Check-in", { exact: true }), b.check_in);
  await d.fill(page.getByLabel("Check-out", { exact: true }), b.check_out);
  await page.getByRole("region", { name: "Entitlement calculation" }).waitFor();
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
  await d.settle();
}

const clip1: ClipDef = {
  slug: "reservation-rules", title: "Reservation rules",
  answers: "Borrowing next year's nights, the booking window, occupancy and upgrades, gifted stays, rescheduling and declining.",
  seed: async () => seedKavya(),
  sections: [
    ...card("Reservation rules"),
    {
      id: 1, title: "Nights left this year",
      run: async (s) => {
        const { page, d } = s;
        const dt = s.shared.dates as KavyaDates;
        if (!dt.fallback) {
          await s.signInAs("demo.reservations", { announce: false, path: s.shared.kavya.url });
          await page.getByRole("link", { name: /Nights left in/ }).filter({ hasText: /^.*2\.0/ }).waitFor();
          await s.begin();
          await d.caption("Kavya has 2 nights left this year.");
          await d.star(page.getByRole("link", { name: /Nights left in/ }), 4500);
          await d.star(page.getByRole("link", { name: /^ASF \d{4}/ }).or(page.getByText(/^ASF \d{4}$/).locator("xpath=ancestor::*[self::a or self::div][1]")).first(), 3000);
        } else {
          // later in the year the clip's stays are next year: show that year's row (the header shows this year)
          await s.signInAs("demo.reservations", { announce: false, path: `${s.shared.kavya.url}?tab=entitlement` });
          const row = page.getByRole("row", { name: new RegExp(`^${dt.year}\\b`) });
          await row.waitFor();
          await s.begin();
          await d.caption(`Kavya has 2 nights left in ${dt.year}.`);
          await d.star(row, 6000);
        }
        await d.pause(1500);
      },
    },
    {
      id: 2, title: "Borrowing next year's nights",
      run: async (s) => {
        const { page, d } = s;
        const dt = s.shared.dates as KavyaDates;
        await s.signInAs("demo.reservations", { announce: false, path: `${s.shared.kavya.url}?tab=reservations` });
        await s.begin();
        await d.caption(`A 4-night stay in ${monthName(dt.request.check_in)}: more than she has left.`);
        await d.pause(1500);
        await newRequest(s, dt.request);
        await page.getByText(new RegExp(`night\\(s\\) from ${dt.nextYear} \\(borrowed\\)`)).waitFor();
        await d.caption(`Short of nights? Up to 2 future years can be borrowed, and that year's fee is due at booking.`);
        await d.star(page.getByRole("region", { name: "Entitlement calculation" }), 5500);
        await d.star(page.getByRole("region", { name: "Annual Subscription Fee" }), 5000);
        await d.click(page.getByRole("button", { name: "Submit request" }));
        await page.getByRole("button", { name: "New reservation" }).waitFor();
        await d.settle();
        await d.pause(2500);
      },
    },
    {
      id: 3, title: "Borrowed nights on the entitlement",
      run: async (s) => {
        const { page, d } = s;
        const dt = s.shared.dates as KavyaDates;
        await s.signInAs("demo.reservations", { announce: false, path: `${s.shared.kavya.url}?tab=entitlement` });
        const row = page.getByRole("row", { name: new RegExp(`^${dt.nextYear}\\b`) });
        await row.waitFor();
        await s.begin();
        await d.caption("Borrowed nights come off next year's balance.");
        await d.star(row, 5500);
        await d.star(page.getByRole("row", { name: new RegExp(`^${dt.year}\\b`) }), 3500);
        await d.pause(1500);
      },
    },
    {
      id: 4, title: "Booking window, occupancy and gifted stays",
      run: async (s) => {
        const { page, d } = s;
        const dt = s.shared.dates as KavyaDates;
        await s.signInAs("demo.reservations", { announce: false, path: `${s.shared.kavya.url}?tab=reservations` });
        await s.begin();
        await d.caption("Too soon? The 7-working-day rule warns staff, and an override needs a reason.");
        await d.pause(1200);
        await newRequest(s, dt.tooSoon);
        const windowAlert = page.getByText("Outside the booking window").locator("xpath=ancestor::*[@role='alert' or @role='status'][1]");
        await windowAlert.waitFor();
        await d.star(windowAlert, 4500);
        await d.type(page.getByLabel("Override reason", { exact: true }), "Member travelling at short notice");
        await d.pause(2000);
        await d.caption("Occupancy is checked against the unit; staff choose an upgrade or a charge.");
        await d.pause(1200);
        await d.fill(page.getByLabel("Adults", { exact: true }), "3");
        const occupancy = page.getByText("Occupancy check").locator("xpath=ancestor::*[@role='alert' or @role='status'][1]");
        await occupancy.waitFor();
        await d.settle();
        await d.star(occupancy, 5000);
        await d.select(page.getByLabel("Unit type", { exact: true }), "T1 One-Bedroom");
        await occupancy.waitFor({ state: "detached" });
        await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
        await d.settle();
        const calc = page.getByRole("region", { name: "Entitlement calculation" });
        await calc.getByText(/1\.5/).first().waitFor(); // the DEMO matrix: an upgrade costs 1.5 nights per night
        await d.caption("An upgrade costs more: each night in a one-bedroom uses 1.5 of her studio nights.");
        await d.star(calc, 5000);
        await d.caption("Gifted stays need the guest's details and the member's message.");
        await d.pause(1200);
        await d.select(page.getByLabel("Occupancy", { exact: true }), "Gift");
        await page.getByLabel("Lead guest name", { exact: true }).waitFor();
        await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
        await d.settle();
        await d.star(page.getByRole("group", { name: "Who" }), 5000);
        await d.pause(1500);
        await d.click(page.getByRole("button", { name: "Discard" }));
        await d.pause(800);
      },
    },
    {
      id: 5, title: "Reschedule",
      run: async (s) => {
        const { page, d } = s;
        const dt = s.shared.dates as KavyaDates;
        await s.signInAs("demo.reservations", { announce: false, path: `/reservations/${s.shared.kavyaStays.stayB}` });
        await s.begin();
        await d.caption("Rescheduling keeps the original dates on record, and 2 reschedules are allowed.");
        await d.pause(1500);
        await d.fill(page.getByLabel("New check-in", { exact: true }), dt.stayBMoved.check_in);
        await d.fill(page.getByLabel("New check-out", { exact: true }), dt.stayBMoved.check_out);
        await d.type(page.getByLabel("Reason", { exact: true }), "Member asked for the following week");
        await d.click(page.getByRole("button", { name: "Reschedule", exact: true }));
        const history = page.locator("section").filter({ has: page.getByRole("heading", { name: "Date history" }) }).first();
        await history.getByText(fmt(dt.stayBMoved.check_in)).first().waitFor();
        await d.settle();
        await d.star(history, 5000);
        await d.star(page.locator("section").filter({ has: page.getByRole("heading", { name: "Stay" }) }).first(), 4000);
        await d.pause(1000);
      },
    },
    {
      id: 6, title: "Decline",
      run: async (s) => {
        const { page, d } = s;
        const dt = s.shared.dates as KavyaDates;
        // the request submitted in section 2
        const api = await apiAs("demo.reservations");
        const list = await api.call<{ items: { id: string; status: string; check_in: string }[] }>("GET", `/reservations?member_id=${s.shared.kavya.id}&page_size=100`);
        await api.dispose();
        const req = list.items.find((r) => r.status === "REQUESTED" && r.check_in === dt.request.check_in);
        if (!req) throw new Error("the 4-night request from section 2 was not found");
        await s.signInAs("demo.reservations", { announce: false, path: `/reservations/${req.id}` });
        await s.begin();
        await d.caption(`The 4-night request holds 2 nights from ${dt.year} and 2 borrowed from ${dt.nextYear}.`);
        await d.star(page.getByRole("region", { name: "Entitlement calculation" }), 4500);
        await d.caption("Declined: the reason is recorded, nights return, and the unused year's fee is withdrawn.");
        await d.select(page.getByLabel("Decline / cancel reason", { exact: true }), "No availability at property");
        await d.type(page.getByLabel("Explanation", { exact: true }), "Resort full on these dates");
        await d.click(page.getByRole("button", { name: "Decline", exact: true }));
        await page.getByText("DECLINED", { exact: true }).first().waitFor();
        const withdrawn = page.getByText(new RegExp(`ASF ${dt.nextYear} withdrawn on`));
        await withdrawn.waitFor();
        await d.settle();
        await d.star(withdrawn, 4000);
        // the proof that the nights came back: Kavya's balance
        await d.click(page.getByRole("link", { name: "Open member" }).or(page.getByRole("button", { name: "Open member" })).first());
        s.freeze(); // hold the last frame until Kavya's record has loaded (no "…" tiles under the caption)
        if (!dt.fallback) {
          const left = page.getByRole("link", { name: /Nights left in/ });
          await left.filter({ hasText: /2\.0/ }).waitFor();
          await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
          await d.settle();
          await s.thaw();
          await d.caption(`Kavya has 2 nights left in ${dt.year} again, and nothing borrowed from ${dt.nextYear}.`);
          await d.star(left, 4500);
          await s.tab("Entitlement");
        } else {
          await page.getByRole("heading", { name: /^MSMC8-/ }).waitFor();
          await s.thaw();
          await s.tab("Entitlement");
          const row = page.getByRole("row", { name: new RegExp(`^${dt.year}\\b`) });
          await row.waitFor();
          await d.caption(`Kavya has 2 nights left in ${dt.year} again, and nothing borrowed from ${dt.nextYear}.`);
          await d.star(row, 4500);
        }
        // and the borrowed year is whole again
        const next = page.getByRole("row", { name: new RegExp(`^${dt.nextYear}\\b`) });
        await next.waitFor();
        await d.settle();
        await d.caption(`${dt.nextYear} is back to its full 7 nights.`);
        await d.star(next, 4500);
        await d.pause(1000);
      },
    },
    endCard(7),
  ],
  check: async (shared) => {
    const dt = shared.dates as KavyaDates;
    const y = await entitlementYears(shared.kavya.id);
    const cur = y[dt.year]!, next = y[dt.nextYear]!;
    if (n(cur.remaining) !== 2) throw new Error(`after the clip Kavya has ${cur.remaining} nights left in ${dt.year}, not 2`);
    if (n(next.borrowed_out) !== 0 || n(next.on_hold) !== 0) throw new Error(`${dt.nextYear} still has nights borrowed or held: ${JSON.stringify(next)}`);
    const api = await apiAs("demo.finance");
    const asf = await api.call<{ membership_year: number; status: string }[]>("GET", `/members/${shared.kavya.id}/asf`);
    await api.dispose();
    const nextAsf = asf.find((a) => a.membership_year === dt.nextYear);
    if (nextAsf && !["WITHDRAWN", "NOT_YET_DUE"].includes(nextAsf.status)) throw new Error(`ASF ${dt.nextYear} is ${nextAsf.status}, not withdrawn`);
    console.log(`    numbers check: ${dt.year} ${cur.remaining} nights left; ${dt.nextYear} nothing borrowed or held; ASF ${dt.nextYear} ${nextAsf?.status ?? "not raised"}`);
  },
};

// ---------------------------------------------------------------- clip 2: money
const inr = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Chooses the member's reservation in the payment dialog's searchable list (by its number). */
async function pickReservation(s: Scene, dlg: ReturnType<Scene["page"]["getByRole"]>, reservationId: string): Promise<void> {
  const { d } = s;
  const api = await apiAs("demo.finance");
  const r = await api.call<{ reservation_number: string }>("GET", `/reservations/${reservationId}`);
  await api.dispose();
  const box = dlg.getByRole("combobox", { name: "Reservation" });
  await d.click(box);
  await d.type(box, r.reservation_number);
  await d.click(dlg.getByRole("option", { name: new RegExp(r.reservation_number) }));
}

let docShots = 0;
/** Open a document (receipt, notice) in the app's preview and give the PDF viewer time to render it. The preview is a
 * narrow side panel, so the recording opens the PDF fitted to the panel's width without the thumbnail strip (Chrome PDF
 * viewer settings `#view=FitH&navpanes=0`, added to the document link the app asks for): the same document and link,
 * only the viewer's view, as a viewer would set with its own buttons. DEMO_DEBUG_DOCS=1 saves a screenshot of each. */
async function openDoc(s: Scene, link: ReturnType<Scene["page"]["getByRole"]>, readMs: number): Promise<void> {
  const { page, d } = s;
  const pattern = "**/api/v1/documents/*/url*";
  await page.route(pattern, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { url: string };
    if (route.request().url().includes("inline=true")) body.url = `${body.url.split("#")[0]}#view=FitH&navpanes=0`;
    await route.fulfill({ response: res, json: body });
  });
  try {
    await d.click(link);
    // the app's viewer shows a loading state until the document has loaded (never an empty box)
    await page.locator('[data-testid="doc-viewer"][data-state="ready"]').waitFor({ timeout: 30_000 });
    const debug = !!process.env.DEMO_DEBUG_DOCS;
    await page.waitForTimeout(d.mode.fast && !debug ? 0 : 2500); // Chrome's PDF viewer paints the first page
    if (debug) await page.screenshot({ path: path.join(CLIPS, "..", `debug-doc-${++docShots}.png`) });
    await d.pause(readMs);
    await page.keyboard.press("Escape");
    await d.pause(500);
  } finally {
    await page.unroute(pattern);
  }
}

const clip2: ClipDef = {
  slug: "money", title: "Money",
  answers: "Booking fees, corrections by reversal, overdue EMIs, default notices and termination, and each brand's receipts.",
  seed: seedClip2,
  sections: [
    ...card("Money"),
    {
      id: 1, title: "Booking fee",
      run: async (s) => {
        const { page, d } = s;
        const dt = s.shared.dates as KavyaDates;
        await s.signInAs("demo.finance", { announce: false, path: `${s.shared.kavya.url}?tab=finance` });
        await s.begin();
        await d.caption(`Booking fees are tied to the stay they belong to: Kavya's ${monthName(dt.stayB.check_in)} stay.`);
        await d.pause(1500);
        await d.click(page.getByRole("button", { name: "Record payment" }));
        const dlg = page.getByRole("dialog", { name: "Record payment" });
        await d.select(dlg.getByLabel("Payment type", { exact: true }), "Booking fee");
        await d.type(dlg.getByLabel("Amount", { exact: true }), "2500");
        await d.select(dlg.getByLabel("Method", { exact: true }), "UPI");
        await d.type(dlg.getByLabel("Transaction / approval reference", { exact: true }), "DEMO-UPI-BKF-01");
        await pickReservation(s, dlg, s.shared.kavyaStays.stayB);
        await d.click(dlg.getByRole("button", { name: /Save payment/ }));
        await page.getByRole("cell", { name: "BOOKING_FEE" }).first().waitFor();
        await d.settle();
        await s.go(`/reservations/${s.shared.kavyaStays.stayB}`);
        const linked = page.getByText(/Linked payments:/);
        await linked.waitFor();
        await d.star(linked, 5000);
        await d.pause(1000);
      },
    },
    {
      id: 2, title: "Correcting a payment",
      run: async (s) => {
        const { page, d } = s;
        await s.signInAs("demo.finance", { announce: false, path: `${s.shared.kavya.url}?tab=finance` });
        // the ledger's row (the money summary above also has a "Booking fee" row, without actions)
        const ledger = page.locator("section").filter({ has: page.getByRole("heading", { name: "Payment ledger" }) }).first();
        const row = ledger.getByRole("row").filter({ hasText: "BOOKING_FEE" }).first();
        await row.waitFor();
        await s.begin();
        await d.caption("Mistakes are corrected with a reversal and a reason, never by editing.");
        await d.pause(1500);
        await d.scrollTo(row);
        await d.click(row.getByRole("button", { name: /^Correct payment/ }));
        const dlg = page.getByRole("dialog", { name: /^Correct payment/ });
        await d.type(dlg.getByLabel("Reason (required)"), "Wrong amount: the fee is 2,000");
        await d.click(dlg.getByRole("button", { name: "Record correction" }));
        await ledger.getByRole("row").filter({ hasText: /reversal/i }).first().waitFor();
        await d.settle();
        await d.scrollTo(ledger, "start");
        await d.star(ledger, 4500);
        // then the correct fee, on the same stay
        await d.caption("Then the correct fee is recorded: ₹2,000.00, on the same stay.");
        await d.pause(1200);
        await d.click(page.getByRole("button", { name: "Record payment" }));
        const pay = page.getByRole("dialog", { name: "Record payment" });
        await d.select(pay.getByLabel("Payment type", { exact: true }), "Booking fee");
        await d.type(pay.getByLabel("Amount", { exact: true }), "2000");
        await d.select(pay.getByLabel("Method", { exact: true }), "UPI");
        await d.type(pay.getByLabel("Transaction / approval reference", { exact: true }), "DEMO-UPI-BKF-02");
        await pickReservation(s, pay, s.shared.kavyaStays.stayB);
        await d.click(pay.getByRole("button", { name: /Save payment/ }));
        const corrected = ledger.getByRole("row").filter({ hasText: "BOOKING_FEE" }).filter({ hasText: "2,000.00" }).filter({ hasNotText: /reversal/i }).first();
        await corrected.waitFor();
        await d.settle();
        await d.scrollTo(ledger, "start");
        await d.star(corrected, 5000);
        await d.pause(1500);
      },
    },
    {
      id: 3, title: "Finance dashboard",
      run: async (s) => {
        const { page, d } = s;
        await s.signInAs("demo.finance", { announce: false, path: "/finance" });
        const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Overdue EMIs" }) }).first();
        await card.getByRole("link", { name: s.shared.rohan.membership_number }).first().waitFor();
        await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
        await s.begin();
        await d.caption("Finance sees every overdue instalment in one place.");
        await d.star(card, 5000);
        await d.pause(1000);
        await d.click(card.getByRole("link", { name: s.shared.rohan.membership_number }).first());
        // no loading skeletons under the caption: hold the last frame until Rohan's finance data is on screen
        s.freeze();
        await page.getByRole("heading", { name: new RegExp(`^${s.shared.rohan.membership_number}`) }).waitFor();
        await page.locator("section").filter({ has: page.getByRole("heading", { name: "EMI schedule" }) }).getByText("OVERDUE", { exact: true }).first().waitFor();
        await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
        await d.settle();
        await s.thaw();
        await d.pause(2500);
      },
    },
    {
      id: 4, title: "Default notice",
      run: async (s) => {
        const { page, d } = s;
        await s.signInAs("demo.finance", { announce: false, path: `${s.shared.rohan.url}?tab=finance` });
        await s.begin();
        await d.caption(`Rohan is ${inr(s.shared.rohanOverdue)} overdue: he gets a formal notice with a 14-day deadline.`);
        const schedule = page.locator("section").filter({ has: page.getByRole("heading", { name: "EMI schedule" }) }).first();
        await d.scrollTo(schedule);
        await d.star(schedule.getByText("OVERDUE", { exact: true }).first().locator("xpath=ancestor::tr[1]"), 3000);
        await d.scrollTo(page.getByRole("button", { name: "Issue default notice" }));
        await d.click(page.getByRole("button", { name: "Issue default notice" }));
        await d.click(page.getByRole("dialog", { name: "Issue default notice?" }).getByRole("button", { name: "Issue default notice" }));
        const notices = page.locator("section").filter({ has: page.getByRole("heading", { name: "Default notices" }) }).first();
        await notices.waitFor();
        await d.settle();
        await d.star(notices, 3000);
        await openDoc(s, notices.getByRole("button", { name: "Notice PDF" }).or(notices.getByRole("link", { name: "Notice PDF" })).first(), 2500);
        await d.scrollTo(page.locator("h1").first(), "start");
        await d.star(page.getByText("DEFAULT NOTICE", { exact: false }).first().locator("xpath=ancestor::*[self::header or self::div][1]"), 3000);
      },
    },
    {
      id: 5, title: "Termination",
      run: async (s) => {
        const { page, d } = s;
        const m = s.shared.meera;
        await s.signInAs("demo.manager", { announce: false, path: `${m.url}?tab=finance` });
        const notices = page.locator("section").filter({ has: page.getByRole("heading", { name: "Default notices" }) }).first();
        await notices.waitFor();
        await s.begin();
        await d.caption("Meera's notice expired with nothing paid. Signed in as Management:");
        await d.pause(1500);
        await d.caption("If the deadline passes, management can terminate: a deliberate, recorded step.");
        await d.scrollTo(notices);
        await d.star(notices, 3000);
        await d.click(page.getByRole("button", { name: "Terminate membership…" }));
        const dlg = page.getByRole("dialog", { name: "Terminate membership?" });
        await d.type(dlg.getByLabel("Termination reason"), "Notice deadline passed with nothing paid");
        await d.type(dlg.getByLabel(`Type ${m.membership_number} to confirm`), m.membership_number);
        await d.pause(800);
        await d.click(dlg.getByRole("button", { name: "Terminate membership" }));
        await page.getByText("TERMINATED", { exact: true }).first().waitFor();
        await d.settle();
        await d.scrollTo(page.locator("h1").first(), "start");
        await d.star(page.getByText("TERMINATED", { exact: true }).first().locator("xpath=ancestor::*[self::header or self::div][1]"), 3500);
      },
    },
    {
      id: 6, title: "Each brand's receipts",
      run: async (s) => {
        const { page, d } = s;
        await s.signInAs("demo.finance", { announce: false, path: `${s.shared.arjun.url}?tab=finance` });
        const ledger = page.locator("section").filter({ has: page.getByRole("heading", { name: "Payment ledger" }) }).first();
        await ledger.waitFor();
        await s.begin();
        // On Windows recording machines WeasyPrint lacks its native libraries, so PDFs use the app's plain-text fallback
        // (no logo): the caption claims only what is on screen, the company details
        await d.caption("Each brand's receipts carry its own company details: K8's, still marked pending confirmation…");
        await d.scrollTo(ledger);
        await openDoc(s, ledger.getByRole("button", { name: "Receipt" }).or(ledger.getByRole("link", { name: "Receipt" })).first(), 3500);
        await s.go(`${s.shared.kavya.url}?tab=finance`);
        await d.caption("…and Club8's, for comparison.");
        const ledger2 = page.locator("section").filter({ has: page.getByRole("heading", { name: "Payment ledger" }) }).first();
        await d.scrollTo(ledger2);
        await openDoc(s, ledger2.getByRole("row").filter({ hasText: "DOWN_PAYMENT" }).getByRole("button", { name: "Receipt" }).or(ledger2.getByRole("row").filter({ hasText: "DOWN_PAYMENT" }).getByRole("link", { name: "Receipt" })).first(), 2500);
      },
    },
    endCard(7),
  ],
  check: async (shared) => {
    const fin = await apiAs("demo.finance");
    const notices = await fin.call<{ amount_overdue: string; status: string }[]>("GET", `/members/${shared.rohan.id}/default-notices`);
    const meera = await fin.call<{ status: string }>("GET", `/members/${shared.meera.id}`);
    await fin.dispose();
    const open = notices.find((x) => x.status === "OPEN");
    if (!open || n(open.amount_overdue) !== shared.rohanOverdue) throw new Error(`Rohan's notice amount ${open?.amount_overdue} does not match his schedule (${shared.rohanOverdue})`);
    if (meera.status !== "TERMINATED") throw new Error(`Meera is ${meera.status}, not TERMINATED`);
    await requireIntactActivityLog("after clip 2");
    console.log(`    numbers check: Rohan's notice ${open.amount_overdue} = overdue on his schedule; Meera terminated`);
  },
};

// ---------------------------------------------------------------- clip 3: control and admin
const clip3: ClipDef = {
  slug: "control-admin", title: "Control and admin",
  answers: "Who can see full ID numbers, the activity log and its export, role permissions, dated rates and the ASF cap, compulsory 2FA, and second-admin approval.",
  seed: async () => seedClip3(),
  sections: [
    ...card("Control and admin"),
    {
      id: 1, title: "Hidden ID numbers",
      run: async (s) => {
        const { page, d } = s;
        // Member services cannot reveal full ID numbers (kyc.view_full): Management can, and every reveal is logged
        await s.signInAs("demo.manager", { announce: false, path: s.shared.neel.url });
        const reveal = page.getByRole("button", { name: /^Reveal / }).first();
        await reveal.waitFor();
        await s.begin();
        await d.caption("Full ID numbers are hidden by default; every reveal is logged.");
        await d.star(reveal.locator("xpath=ancestor::*[self::div or self::dd][1]"), 3000);
        await d.click(reveal);
        const dlg = page.getByRole("dialog", { name: /^Reveal / });
        await dlg.waitFor();
        await d.star(dlg, 3000);
        await d.click(dlg.getByRole("button", { name: "Reveal", exact: true }));
        const hides = page.getByText("hides in 30 s");
        await hides.waitFor();
        await d.star(hides.locator("xpath=ancestor::*[self::div or self::dd][1]"), 3500);
        await d.caption("30 seconds later, it hides itself again.");
        await s.cut(30_500); // a real cut: the app's own 30-second timer runs, the clip skips the wait
        await hides.waitFor({ state: "detached" });
        await d.star(reveal.locator("xpath=ancestor::*[self::div or self::dd][1]"), 3000);
      },
    },
    {
      id: 2, title: "Activity log filter and export",
      run: async (s) => {
        const { page, d } = s;
        await s.signInAs("demo.admin", { announce: false, path: "/activity" });
        await page.getByRole("table", { name: "User activity log" }).getByRole("row").nth(1).waitFor();
        await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
        await s.begin();
        await d.caption("Management can filter the log, here for every view of a full ID number…");
        await d.type(page.getByLabel("Action", { exact: true }), "KYC_VIEW");
        const row = page.getByRole("table", { name: "User activity log" }).getByRole("row").filter({ hasText: "KYC_VIEW" }).first();
        await row.waitFor();
        await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
        await d.settle();
        await d.star(row, 4000);
        await d.caption("…and export it to Excel.");
        const download = page.waitForEvent("download");
        await d.click(page.getByRole("link", { name: "Export Excel" }));
        const file = await download;
        if (!/\.xlsx$/i.test(file.suggestedFilename())) throw new Error(`export downloaded ${file.suggestedFilename()}, not an Excel file`);
        await d.pause(2500);
      },
    },
    {
      id: 3, title: "Role permissions",
      run: async (s) => {
        const { page, d } = s;
        await s.signInAs("demo.admin", { announce: false, path: "/admin" });
        const grid = page.locator("section").filter({ has: page.getByRole("heading", { name: "Role permissions" }) }).first();
        await grid.waitFor();
        await d.scrollTo(grid, "start");
        await s.begin();
        await d.caption("Management decides who can do what, permission by permission.");
        for (const code of ["payment.correct", "member.terminate", "kyc.view_full"]) {
          const row = grid.getByRole("row").filter({ hasText: code }).first();
          await d.scrollTo(row);
          await d.moveTo(row);
          await d.star(row, 2600);
        }
      },
    },
    {
      id: 4, title: "Dated rates and the ASF cap",
      run: async (s) => {
        const { page, d, guard } = s;
        await s.signInAs("demo.admin", { announce: false, path: "/admin" });
        await s.begin();
        await d.caption("Rates are added as new dated rows; an ASF rise above 5% needs an override.");
        await s.tab("Master data");
        await d.click(page.getByRole("navigation", { name: "Master data tables" }).getByRole("link", { name: /ASF/ }).or(page.getByRole("navigation", { name: "Master data tables" }).getByRole("button", { name: /ASF/ })).first());
        await d.settle();
        await d.click(page.getByRole("button", { name: "Add entry" }));
        const dlg = page.getByRole("dialog", { name: /^Add to / });
        await d.fill(dlg.getByLabel("New entry JSON"), JSON.stringify(s.shared.asfDraft, null, 2));
        await d.pause(2500);
        await guard.expect(422, /\/admin\/master\/asf-rates/, async () => {
          await d.click(dlg.getByRole("button", { name: "Add", exact: true }));
          await dlg.getByText(/exceeds the \d+% annual cap/).waitFor(); // the refusal itself (the field label also says "cap")
          await d.settle();
          await d.star(dlg, 4500);
        });
        await d.click(dlg.getByRole("button", { name: "Close", exact: true }).last()); // the footer button (the corner icon is also "Close")
        await d.pause(800);
      },
    },
    {
      id: 5, title: "Compulsory two-step verification",
      run: async (s) => {
        const { page, d } = s;
        await s.signInAs("demo.admin", { announce: false, path: "/admin" });
        const card = page.locator("section").filter({ has: page.getByText("Two-step verification policy") }).first();
        await card.waitFor();
        await d.scrollTo(card);
        await s.begin();
        await d.caption("2FA can be made compulsory for chosen roles: here, Finance.");
        await d.check(card.getByRole("checkbox", { name: /^Finance/ }));
        await d.type(card.getByLabel("Reason for the change"), "Finance handles payments: 2FA from today");
        await d.click(card.getByRole("button", { name: /^Save/ }));
        await page.getByText("Two-step verification policy saved").waitFor();
        await d.settle();
        await d.pause(1500);
        // Finance's next sign-in, on the same screen (cookies cleared): set-up comes first
        await s.ctx.clearCookies();
        await d.caption("Finance's next sign-in: they must set up 2FA before using the CRM.");
        await s.go("/login");
        await d.type(page.getByLabel("Username", { exact: true }), "demo.finance");
        await d.type(page.getByLabel("Password", { exact: true }), "Demo-Passw0rd!");
        await d.click(page.getByRole("button", { name: "Sign in" }));
        const qr = page.getByRole("img", { name: /QR|authenticator/i }).first();
        await qr.waitFor();
        await d.settle();
        await d.star(qr.locator("xpath=ancestor::*[self::section or self::main or self::div][2]"), 4500);
      },
    },
    {
      id: 6, title: "Second-admin approval",
      run: async (s) => {
        const { page, d } = s;
        await s.signInAs("demo.admin", { announce: false, path: "/admin" });
        const row = page.getByRole("row").filter({ hasText: "demo.admin3" }).first();
        await row.waitFor();
        await d.scrollTo(row);
        await s.begin();
        await d.caption("Resetting an administrator needs a second administrator's approval.");
        await d.click(row.getByRole("button", { name: "Reset password…" }));
        const dlg = page.getByRole("dialog", { name: "Reset password for demo.admin3?" });
        await d.type(dlg.getByRole("textbox").first(), "Lost access to the authenticator and password");
        await d.click(dlg.getByRole("button", { name: "Request reset" }));
        const waiting = page.locator("section").filter({ has: page.getByText("Administrator resets waiting for approval") }).first();
        await waiting.getByText("demo.admin3").first().waitFor();
        await d.settle();
        await d.scrollTo(waiting);
        await d.star(waiting, 4000);
        await s.signInAs("demo.admin2", { path: "/admin" });
        const waiting2 = page.locator("section").filter({ has: page.getByText("Administrator resets waiting for approval") }).first();
        await d.scrollTo(waiting2);
        await d.click(waiting2.getByRole("button", { name: /^Approve/ }).first());
        const approve = page.getByRole("dialog", { name: /^Approve the reset of demo\.admin3/ });
        await d.type(approve.getByRole("textbox").first(), "Confirmed with demo.admin3 by phone");
        await d.click(approve.getByRole("button", { name: /^Approve/ }));
        // demo.admin3 has a registered email, so the request was for a reset link (the default): nobody sees a password
        const sent = page.getByText(/^Reset link sent to /);
        await sent.waitFor();
        await d.caption("Approved: the reset link goes to demo.admin3's registered email. Nobody sees a password.");
        await d.star(sent, 4000);
      },
    },
    endCard(7),
  ],
  check: async () => {
    await requireIntactActivityLog("after clip 3");
  },
};

export const CLIP_DEFS: Record<number, ClipDef> = { 1: clip1, 2: clip2, 3: clip3 };

/** out/clips/clips-index.md: the clips recorded so far, with their lengths, ready to paste into a message. */
export function writeClipsIndex(): void {
  const rows: string[] = [];
  for (const [num, def] of Object.entries(CLIP_DEFS)) {
    const out = clipOutput(Number(num), def.slug, def.sections.length);
    if (!fs.existsSync(out.qcReport)) continue;
    const qc = fs.readFileSync(out.qcReport, "utf8");
    const length = /^length: (\S+)/m.exec(qc)?.[1] ?? "?";
    const size = /^size: (.+)$/m.exec(qc)?.[1] ?? "?";
    rows.push(`| ${num} | ${def.title} | \`${path.basename(out.mp4)}\` | ${length} | ${size} | ${def.answers} |`);
  }
  const md = [
    "# Club8 CRM: follow-up demo clips",
    "",
    `Recorded ${istToday().split("-").reverse().join("-")} with fictitious demo data.`,
    "",
    "| # | Clip | File | Length | Size | What it answers |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  fs.mkdirSync(CLIPS, { recursive: true });
  fs.writeFileSync(path.join(CLIPS, "clips-index.md"), md);
}
