# Demo Clips Prompt: Three Follow-up Clips for the Club8 CRM

## 0. Goal and rules

The main demo video (`demo-video/`, from `docs/DEMO_VIDEO_PROMPT.md`) tells the happy-path story. Now produce **three short follow-up clips, 2–3 minutes each**, answering the questions Club8 is most likely to ask next:

1. **Reservation rules:** reschedule, decline, borrowing next year's nights, booking-window warning, occupancy and upgrade.
2. **Money:** booking fee, payment correction, overdue EMI → default notice → termination, finance dashboard, K8 receipt.
3. **Control and admin:** roles and permissions, dated rates and the 5% ASF cap, 2FA policy, KYC reveal logging, activity-log filter and export, second-admin approval.

Rules, all carried over from `DEMO_VIDEO_PROMPT.md`:
- **Reuse the existing recorder.** Use the same overlays (cursor, click ring, lower-third captions), pacing, title and end cards, ffmpeg settings and QC checks. Add a `--clip <1|2|3>` option, or a separate entry point; don't fork the code.
- **Fictitious data only,** in a **throwaway database** created for each run: the Docker Postgres container if task 2 of the Docker work is done, otherwise the embedded fallback. Never touch `crm_local` or any demo database people use.
- **Real UI, real clicks.** Set up the starting data through the API or a seed script, never by hand-editing tables.
- **No app changes for the video.** If a scenario needs time to pass (an overdue EMI, an expired 14-day notice), first use what the app and tests already offer (back-dated dates the API accepts, or the test suite's clock control). If a clock override is truly needed, it may only exist in the recording or test environment, must be refused when `CRM_ENV` is `staging` or `prod`, and must be recorded in `DECISIONS.md`. Ask me before adding one.
- **Don't change shared settings permanently.** Anything a clip switches on (e.g. the 2FA policy) only happens in the throwaway database.
- Outputs go in `demo-video/out/clips/` (gitignored). Commit only the code and docs, without Claude as a co-author.
- **Before writing code, show me a short plan:** the seed data each clip needs, and how you'll produce the time-dependent states. Wait for my approval.

## 1. Seed data for the clips

Create `demo-video/src/seed-clips.ts` (or a Python equivalent next to the existing demo seed). All data is fictitious and labelled DEMO. It creates, through the API:

| Member | Brand | Set up so that… | Used in |
|---|---|---|---|
| **Kavya Demo** (MSMC8-…) | Club8 | Active; Premium / Red / Studio; 7 nights a year. 2026 already has 5 nights used, so 2 are left. ASF 2026 paid, ASF 2027 not yet raised. One confirmed stay about 6 weeks ahead (3 nights). | Clip 1 |
| **Rohan Demo** | Club8 | Active, on EMIs, with the first EMI more than 30 days overdue (due date in the past). No default notice yet. | Clip 2 |
| **Meera Demo** | Club8 | Active, with a default notice issued **more than 14 days ago** and still unpaid, so it is ready to terminate. | Clip 2 |
| **Arjun Demo** | **K8** | Active, with one payment recorded, so a K8-branded receipt exists. | Clip 2 |
| **Neel Demo** | Club8 | Active, with full KYC on file (fictitious PAN), so the masked/reveal behaviour can be shown. | Clip 3 |
| **demo.admin2** | — | A second ADMIN user (2FA on, fictitious key), so a second admin can approve an admin password reset. | Clip 3 |

Also seed:
- a confirmed stay for Kavya on which a **booking fee** can be recorded (clip 2), or reuse her upcoming stay;
- enough activity-log entries (the normal result of seeding) for the filter in clip 3 to be meaningful.

## 2. Storyboards

Timings are targets. Each clip has a 4-second title card (both logos, "Club8 CRM · <clip title>", "Demo with fictitious data") and a 5-second end card (the same as the main video's). The ★ moments get the outline highlight and 3–4 seconds on screen. Captions are plain business language, one idea each, and at least 2.5 seconds long.

### Clip 1: Reservation rules (target 2:45)

| # | Signed in as | On screen | Caption idea | Approx. |
|---|---|---|---|---|
| 1 | demo.reservations | Kavya's header: 2 nights left in 2026, ASF 2026 paid. | "Kavya has 2 nights left this year." | 0:10 |
| 2 | | New reservation, 4 nights. ★ The calculation splits it: **2 nights from 2026 + 2 borrowed from 2027**, and **ASF 2027 is raised now** at the current rate. Submit. | "Short of nights? Up to 2 future years can be borrowed — and that year's fee is due at booking." | 0:30 |
| 3 | | Entitlement tab: 2027 shows 2 nights borrowed out. | "Borrowed nights come off next year's balance." | 0:12 |
| 4 | | Start another request with check-in 3 days away. ★ An amber **booking-window warning** (under 7 working days). Show that it needs an override reason. Cancel. | "Too soon? The 7-working-day rule warns staff, and an override needs a reason." | 0:20 |
| 5 | | Same form: 3 adults in a Studio. ★ The **occupancy check** offers an upgrade to One-Bedroom (nights recalculated) or an upgrade charge. Cancel. | "Occupancy is checked against the unit; staff choose an upgrade or a charge." | 0:20 |
| 6 | | Same form: occupancy "Gift". Guest name and contact become required, plus a linked member communication. Cancel. | "Gifted stays need the guest's details and the member's message." | 0:15 |
| 7 | | Open Kavya's confirmed stay → Reschedule to dates 1 week later with a reason. ★ **Date history** keeps the original dates; the reschedule count goes to 1 of 2; nights are adjusted, not deducted twice. | "Rescheduling keeps the original dates on record — 2 reschedules allowed." | 0:25 |
| 8 | | Open the new request from step 2 → **Decline** with a reason from the list plus an explanation. ★ The held nights return, including the borrowed 2027 nights, and the unpaid ASF 2027 is withdrawn. | "Declined: the reason is recorded, nights return, and the unused year's fee is withdrawn." | 0:25 |
| — | | End card | | 0:05 |

### Clip 2: Money (target 2:45)

| # | Signed in as | On screen | Caption idea | Approx. |
|---|---|---|---|---|
| 1 | demo.finance | Kavya → Finance → Record payment, type **Booking fee**, linked to her December stay. Then open the reservation: ★ the fee shows there too. | "Booking fees are tied to the stay they belong to." | 0:25 |
| 2 | | On a payment, click **Correct**: enter a reason. ★ The ledger shows the original payment plus a reversal entry; nothing is edited or deleted. | "Mistakes are corrected with a reversal and a reason — never by editing." | 0:25 |
| 3 | | Finance dashboard: overdue EMIs, reservations waiting on ASF, default notices with days left. Click Rohan's overdue row. | "Finance sees every overdue instalment in one place." | 0:15 |
| 4 | | Rohan → ★ **Issue default notice**. The notice PDF opens, showing the 14-day deadline. The member status changes to Default notice, with a countdown banner. | "An overdue member gets a formal notice with a 14-day deadline." | 0:30 |
| 5 | demo.manager | Meera, whose notice expired with nothing paid → ★ **Terminate membership**. A reason is required and the membership number must be typed to confirm. The status becomes Terminated; payments are forfeited and reservations blocked. | "If the deadline passes, management can terminate — a deliberate, recorded step." | 0:30 |
| 6 | demo.finance | Arjun (K8) → open a receipt PDF. ★ The **K8 logo and legal name**, with a "pending confirmation" note, are shown next to a Club8 receipt for comparison. | "Each brand's receipts carry its own logo and company details." | 0:20 |
| — | | End card | | 0:05 |

### Clip 3: Control and admin (target 2:45)

| # | Signed in as | On screen | Caption idea | Approx. |
|---|---|---|---|---|
| 1 | demo.service | Neel's profile: PAN masked. Click Reveal: "This view will be logged". ★ The full number shows, then **hides again after 30 seconds** (speed this up with a cut, not by changing the timer). | "Full ID numbers are hidden by default; every reveal is logged." | 0:25 |
| 2 | demo.admin (2FA) | Activity log → filter Action = KYC view. ★ Neel's reveal appears with who and when. Click **Export Excel**: the download starts. | "Management can filter the log and export it to Excel." | 0:25 |
| 3 | | Admin → Role permissions grid. Hover a few permissions (e.g. `payment.correct`, `member.terminate`) to show which roles have them. Don't save changes. | "Management decides who can do what, permission by permission." | 0:20 |
| 4 | | Master data & rates → ASF rates: add a new dated rate **10% higher** for next year. ★ The **5% cap warning** requires an override reason and special permission. Cancel. | "Rates are added as new dated rows; an ASF rise above 5% needs an override." | 0:25 |
| 5 | | Two-step verification policy → tick **Finance** → save. Sign in as demo.finance in a second context: ★ they must set up 2FA (QR screen) before using the CRM. | "2FA can be made compulsory for chosen roles." | 0:25 |
| 6 | demo.admin → demo.admin2 | Reset password for demo.admin2 → ★ "Waiting for a second administrator". Switch to demo.admin2 (2FA): Approvals panel → Approve, with a reason. | "Resetting an administrator needs a second administrator's approval." | 0:25 |
| — | | End card | | 0:05 |

## 3. Outputs

In `demo-video/out/clips/`, for each clip *n*:
- `club8-crm-clip<n>-<slug>.mp4` (1920×1080, H.264, `yuv420p`, limited range, 30 fps, `+faststart`, under 50 MB);
- `club8-crm-clip<n>-<slug>.srt` and `chapters-clip<n>.txt`.

The slugs are `reservation-rules`, `money` and `control-admin`.

Also produce a `clips-index.md` listing the three clips, their lengths, and one line on what each answers, ready to paste into a message to Club8.

## 4. Quality check before you tell me it's done

For each clip, run the same QC as the main video, plus these checks:
- Every ★ moment is readable, with no loading skeletons under a caption; wait for data before showing a caption.
- The numbers on screen are consistent. Clip 1: Kavya's 2026 and 2027 balances add up after borrowing, rescheduling and declining. Clip 2: Rohan's overdue amount matches his schedule.
- No real data, no DEV badge, no console errors, no error toasts.
- Each clip is between 2:00 and 3:15.
- Nothing from the clips leaks into any other database. The throwaway database is removed after each run, including when a run fails.

Then report: each clip's length, size and chapter times; any scenario you couldn't show and why; and anything you had to set up differently from this storyboard.

## 5. Docs

- Add a "Follow-up clips" section to `demo-video/README.md`, covering how to record one clip or all three and how to change captions.
- Add the clips to `docs/DEMO_SCRIPT.md` as optional chapters, so a live presenter can follow the same steps.
