# Demo Video Prompt: Record a Club8 CRM Demo with Playwright

## 0. Goal and rules

Produce a **5:00–6:30 screen-recorded demo video** of the running Club8 CRM, for the Club8 owners. It follows the story in the walkthrough guide (`docs/DEMO_SCRIPT.md` and the walkthrough HTML): one new member goes from street lead to confirmed holiday, plus a short look at the audit trail and password features.

Rules:
- **Fictitious demo data only.** Never show real names, phone numbers, PANs or Aadhaar numbers. Reset and re-seed a dedicated recording database first, so the video starts from a clean, predictable state.
- **Don't change the application to make the video.** Overlays (cursor, click highlight, captions, title cards) are injected by the recording script only. They must never ship in the app.
- **Real clicks, real screens.** Drive the actual UI with Playwright at human speed. Don't fake screens with mock HTML, apart from the title and end cards.
- **Keep the video out of git.** Write outputs to `demo-video/out/` and add that folder to `.gitignore`. Commit only the script and its documentation.
- Don't add Claude as a co-author on commits.
- Before writing code, show me a short plan: the storyboard as you'll implement it, how you'll reset the data, and the tools (Playwright and ffmpeg). Wait for my approval.

## 1. Technical setup

- **Location:** a Playwright script (TypeScript) in `demo-video/`, run with `npm run record` (or `python -m` if you prefer Python Playwright). It must not run as part of the normal test suite or CI.
- **Recording:** a Chromium context with `recordVideo: { dir, size: { width: 1920, height: 1080 } }` and viewport 1920×1080. Use `deviceScaleFactor: 1` so text is crisp at 1080p.
- **Data:** before recording, recreate a separate database (e.g. `crm_video`) and run the demo seed. Point the app at it via environment variables for the recording run only. Never touch the developers' working demo database.
- **Dates:** use relative dates (check-in about 3 weeks ahead, EMIs from next month) so the video stays valid whenever it's re-recorded.
- **2FA:** generate `demo.admin`'s 6-digit codes in the script from the demo key, using a TOTP library.
- **Environment badge:** hide the orange **DEV** badge for the recording through a recording-only setting or injected CSS, so the owners see what production will look like. Don't change the app's default behaviour.
- **Role switching:** do one visible sign-in at the start (to show the login page and the show-password eye). After that, switch users using pre-saved Playwright `storageState` per role, so the video doesn't sign in and out eight times. A caption announces each switch (e.g. "Now signed in as Finance").

## 2. Making it watchable

- **Pace:**
  - typing at about 60 ms per character;
  - mouse moves animated over about 400 ms before each click;
  - a 1.5–3 second pause on every screen the viewer needs to read;
  - an extra 3–4 seconds on the key moments in Section 3 marked ★.
- **Visible cursor:** Playwright doesn't render the mouse pointer, so inject a small cursor overlay that follows the mouse, plus a brief ring animation on each click.
- **Captions:** inject a lower-third caption bar.
  - Styling: brand indigo `#393186` background at about 90% opacity, white text, 28–32 px, maximum two lines, with a thin orange `#EF7F1B` top rule.
  - Each step gets one short caption, written in plain business language (not technical terms), e.g. "The system calculates nights and the annual fee before anything is submitted."
  - Captions fade in and out over 200 ms.
- **Highlight:** for ★ moments, draw a soft outline around the element being discussed (e.g. the ASF calculation box, the blocked Confirm button).
- **No scroll jumps:** scroll smoothly (`scrollIntoView({behavior:'smooth'})`) and wait for scrolling to finish.
- **No loading flashes:** wait for network idle and for skeleton loaders to disappear before each pause.
- **Sound:** none in this version. Also write the captions to `club8-crm-demo.srt`, so a voice-over can be recorded later from the same script.

## 3. Storyboard (target timings)

| # | Section | Signed in as | What happens on screen | Approx. |
|---|---|---|---|---|
| 0 | **Title card** | — | Club8 Holidays and K8 logos, "Club8 CRM — from street lead to confirmed holiday", "Demo with fictitious data". | 0:06 |
| 1 | Sign in & dashboard | demo.sales | Login page. Type the username and password, click the eye to show the password, then sign in. Dashboard with six tiles. Press Ctrl+K and search `9001`. | 0:30 |
| 2 | Capture a lead | demo.sales | New lead form filled at typing speed. Then: Contacted → Presentation scheduled → Attended. Show the status history. | 0:35 |
| 3 | Convert to member | demo.sales | Convert to member. Fill the purchaser, membership and payment sections. ★ Totals and balance calculate as you type. Create the member, which starts as Pending approval. | 0:50 |
| 4 | Approve | demo.manager | Upload the signed agreement. ★ The approval panel shows "All checks passed". Approve, then open the Entitlement tab showing 7 nights per year. | 0:30 |
| 5 | Payments | demo.finance | Generate the EMI schedule. Record one EMI payment by UPI; instalment 1 shows Paid. Open the receipt PDF briefly. | 0:35 |
| 6 | Book a stay | demo.reservations / demo.finance | New reservation (Goa, 4 nights). ★ The live calculation of nights and ASF + GST. Submit, then Approve. ★ Confirm is refused because the ASF is unpaid. Switch to Finance and pay ASF 2026. Switch back and Confirm, which now works. Generate the voucher. Show the entitlement: 4 used, 3 left. | 1:15 |
| 7 | Member services | demo.service | Log an email and a call. The timeline updates. | 0:20 |
| 8 | Audit trail | demo.manager / demo.admin | Edit a profile field with a reason. History shows the old → new values. As admin, enter the 2FA code, open the Activity log and click ★ Verify integrity. | 0:35 |
| 9 | Passwords & access | demo.admin | Admin → New user: the temporary password is shown once. Open the reset-password dialog (with the reason field), then cancel. Show the forgot-password page and the Mailpit email briefly. | 0:30 |
| 10 | On the phone | demo.sales | Switch to a 390×844 viewport, recorded as a separate clip. Dashboard and search. | 0:15 |
| 11 | **End card** | — | "Club8 CRM": key points (one system for both brands, every change on record, ASF rules enforced), plus the contact line from me. | 0:08 |

Total: about 5 minutes 30 seconds as first planned; with the "Cancel a stay" section and the Docker recording database
it runs about 6:10, which is accepted. The limit is **6:30**, the same as the main video in
`docs/DEMO_VOICEOVER_PROMPT.md`. If you run over 6:30, shorten pauses on non-★ steps; don't drop sections.

**In section 9, don't complete a password reset or create clutter that remains afterwards.** Cancel the reset dialog. The new user exists only in the throwaway recording database.

## 4. Post-production (ffmpeg)

- Record each section as its own clip (a new page or context per section), so a section can be re-recorded without redoing everything.
- **Joining clips:** concatenate the clips in order with 300 ms crossfades between sections, and convert to **MP4 (H.264, yuv420p, CRF ~20, 30 fps, `+faststart`)** so it plays everywhere, including WhatsApp and PowerPoint.
- **Phone clip:** for section 10, place the 390×844 clip centred on a 1920×1080 brand-coloured background (`#F7F7FB`) with a soft shadow, so it looks like a phone screen.
- **Title and end cards:** render them as HTML pages, styled with the brand tokens and logos from `public/brand/`, and record them like the other sections.

**Outputs, in `demo-video/out/`:**
- `club8-crm-demo.mp4` — the full video;
- `club8-crm-demo.srt` — the captions;
- `chapters.txt` — chapter start times, for YouTube or a slide;
- `club8-crm-demo-thumb.png` — a thumbnail taken from the reservation calculation screen.

## 5. Quality check before you tell me it's done

Watch the finished MP4 yourself, or sample frames every 5 seconds and review them, and confirm:
- no real personal data anywhere; only the fictitious demo data;
- no DEV badge, no browser error pages, no error toasts, and no console errors during recording (collect them; the run fails if any appear);
- every caption is readable and on screen for at least 2.5 seconds;
- the cursor is visible, clicks show the ring, and there are no jumps or blank frames between sections;
- the ★ moments are on screen long enough to read;
- the length is between 5:00 and 6:30, and the file is under 100 MB;
- the password typed in section 1 appears only as dots, except during the deliberate eye-button moment. In that moment the demo password is visible for 1–2 seconds, which is acceptable because it is fictitious and only for the demo environment.

Then report: the file path, length, size, the chapter times, and anything you had to compromise on.

## 6. Re-recording later

Document in `demo-video/README.md` how to re-record:
- the full video, or a single section (e.g. `npm run record -- --section 6`);
- how to change a caption;
- how to switch to a voice-over later using the SRT file.

The video should be easy to refresh whenever the screens change.
