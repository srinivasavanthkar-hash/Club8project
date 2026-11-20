# Club8 CRM demo video

A 5:00–6:30 screen recording of the real CRM for the Club8 owners: one new member from street lead to confirmed
holiday, plus the audit trail and password features. The brief is `docs/DEMO_VIDEO_PROMPT.md`; the story follows
`docs/DEMO_SCRIPT.md` and the walkthrough.

Everything shown is **fictitious demo data**, recorded against a throwaway database. The video files never go in
git (`demo-video/out/` is ignored); only this script and its documentation are committed.

## Record

```bash
cd demo-video
npm ci                                 # once
npm run record                         # fresh stack, all sections, then assembles the MP4 (about 15 minutes)
npm run record -- --no-build           # reuse the previous recording build of the frontend (faster)
npm run record -- --section 6          # re-record one section only (see below)
npm run record -- --clip all           # the three follow-up clips (see "Follow-up clips" below)
npm run assemble                       # only re-join the existing clips (out/clips) into the MP4
```
The flags combine, e.g. `npm run record -- --section 6 --no-build`.

### The recording stack (Docker)

Every run starts from a fresh `crm_video` database and its own containers on a private Docker network
`club8-crm-video`: a throwaway `postgres:16-alpine` (`club8-crm-video-db`, `127.0.0.1:5433`, data on tmpfs, no
volume), Mailpit and Azurite (the same images as docker-compose), and **the API from the backend Docker image**
(`club8-crm-backend:video`, built at the start of the run). The image carries the PDF engine (WeasyPrint + Pango), so
receipts, notices and vouchers in the recordings are the real branded PDFs; the API refuses to start without a PDF
engine. Only the frontend runs on this machine. (`--db embedded` was removed on 19-11-2026: without Docker there is
no PDF engine on Windows.)

The run waits for the database's health check (`pg_isready` over TCP, polled every second, up to two minutes)
instead of a fixed timeout, and removes the containers and the network at the end: also when a section fails, the
run is interrupted with Ctrl+C, or the script crashes. Containers left by a run that was killed outright (e.g. the
terminal closed) are removed at the start of the next run. The API log is saved to `.local/video-api.log`. To remove
everything by hand: `docker rm -f club8-crm-video-api club8-crm-video-azurite club8-crm-video-mailpit
club8-crm-video-db` and `docker network rm club8-crm-video`. Stop the docker-compose demo stack first if it is
running: both publish Azurite on port 10000.

Outputs in `demo-video/out/`:

| File | What |
|---|---|
| `club8-crm-demo.mp4` | the video: H.264, yuv420p, limited ("tv") range, BT.709, CRF 20, 30 fps, `+faststart` (plays in WhatsApp and PowerPoint). The screencast JPEGs are full-range BT.601, so every clip is converted explicitly and tagged; `qc-report.txt` checks the tags and that luma stays within 16–235 |
| `club8-crm-demo.srt` | the captions, timed to the final video |
| `chapters.txt` | chapter start times (YouTube description, a slide) |
| `club8-crm-demo-thumb.png` | thumbnail, from the reservation calculation screen |
| `qc-report.txt`, `qc/` | length, size, caption check, a frame every 5 s and contact sheets for review |
| `clips/NN.mp4` + `NN.json` | one clip per section, with its caption times (used for re-recording one section) |

### Requirements

- The repo's backend virtualenv (`.venv`) and frontend `node_modules` (as for running the app locally).
- **ffmpeg** in `.local/ffmpeg/` (git-ignored). Version and source:
  - `ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip` (ffmpeg 8.1.3, static GPL build with libx264)
  - from the BtbN FFmpeg-Builds GitHub release `autobuild-2026-10-31-12-59`:
    https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59
  - SHA-256 `401dffcf14c301082e1fc03b0bc876b92ea676bfc521fc56e80a1537d137034f`, checked against the release's
    `checksums.sha256` and GitHub's asset digest. Unzip so that
    `.local/ffmpeg/ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1/bin/ffmpeg.exe` exists.
- **Docker** (Docker Desktop): database, API (backend image), Mailpit and Azurite run in containers (see above).
- Playwright's Chromium: the same Playwright version as the frontend (1.65.1), so one browser download serves both
  (`npx playwright install chromium`).
- PDFs (receipts, vouchers, notices) are made by the recording API in the backend image: the same branded PDFs
  as Docker and Azure, with the logo, ₹ and plain labels.

## How it works

- **Recording stack** (`src/stack.ts`): a fresh database `crm_video` (in Docker, see "The recording stack";
  `scripts/local_db.py` runs the migrations and DEMO seed, then the Section 14
  scenario runs so the dashboard has content), its own API on :8002, a separately built frontend on :3002
  (`frontend/.next-video`), Mailpit on :8027 and Azurite on :10000 for documents. The developers' `crm_local` is
  never touched. Everything is stopped at the end. The frontend runs **without `CRM_ENV`**, so the DEV badge is not
  shown, exactly as in production; the app itself is unchanged.
- **Capture** (`src/screencast.ts`): Chrome's own screencast (CDP `Page.startScreencast`, JPEG quality 92) at
  1920×1080, encoded to constant 30 fps by ffmpeg. Playwright's built-in `recordVideo` was tried first: it encodes
  VP8 at under 1 Mbit/s for 1080p and small UI text came out visibly soft, so it is not used.
- **Overlays** (`src/overlay.ts`): cursor, click ring, caption bar (brand indigo, orange top rule), highlight
  outline for the ★ moments. Injected into the page by the recording script only; they are not part of the app.
- **Pace**: typing 60 ms per character, 400 ms mouse moves, 1.5–3 s reading pauses, 3.5–4 s on ★ moments.
- **Sign-ins**: one visible sign-in in section 1 (with the show-password eye) and one in section 9 (the
  administrator's 2FA code, generated from the FICTITIOUS demo key with the `otpauth` library). Everywhere else the
  script swaps in a saved session for the role and a caption says "Now signed in as …".
- **Dates** are relative (stay about 3 weeks ahead, EMIs from next month), so a re-recording is always valid.
- **The run fails** on any console error, page error, failed request, unexpected HTTP error, error toast or error
  page. Expected refusals (Confirm while the ASF is unpaid, the 2FA step at sign-in) are declared in the section.
- **Browser**: Chromium's newer headless mode (`channel: "chromium"`), which includes the PDF viewer used for the
  receipt in section 5.

## Re-record one section

`npm run record -- --section 6` starts a fresh stack, replays sections 1–5 **without recording** (fast, to recreate
the same data: the lead, member MSMC8-9002, payments), records section 6 into `out/clips/06.mp4`, then re-assembles
the video with the other clips already in `out/clips/`. Sections: 0 title card, 1 sign in, 2 lead, 3 convert,
4 approve, 5 payments, 6 reservation, 7 cancellation, 8 member services, 9 audit trail, 10 passwords, 11 phone, 12 end card.

## Change a caption

Captions are the `d.caption("…")` and `s.step("…")` calls in `src/record.ts`, one per step, in plain business
language. Edit the text, then re-record that section (`--section N`); the SRT and chapters are regenerated from the
clips' timing. Keep captions to two lines. The title and end cards are `cards/title.html` and `cards/end.html`
(re-record section 0 or 12 after editing).

## Follow-up clips

Three short clips (`docs/DEMO_CLIPS_PROMPT.md`) answer the questions Club8 is likely to ask after the main video. They use
the same recorder (overlays, pacing, cards, ffmpeg settings and QC); the clips are defined in `src/clips.ts` and their
data in `src/seed-clips.ts`.

```bash
npm run record -- --clip 1             # one clip: 1 reservation rules, 2 money, 3 control and admin
npm run record -- --clip all           # all three, one after the other
npm run record -- --clip 2 --dry       # seed and run the clip's scenes at full speed without recording (a check)
```

Each clip runs on **its own fresh stack and throwaway database** (Docker, as above), seeded
through the API, and the database is removed afterwards, also when the run fails. `--no-build` reuses the frontend
build. Outputs in `demo-video/out/clips/`: `club8-crm-clip<n>-<slug>.mp4` and `.srt`, `chapters-clip<n>.txt`,
`qc-clip<n>.txt`, and `clips-index.md` (the clips, their lengths and what each answers, ready to paste into a message).
The clips' section files are in `out/clip<n>/` (the main video's stay in `out/clips/NN.mp4`).

QC per clip: the main video's checks (format, limited range, captions at least 2.5 s, no console errors or error
toasts, no DEV badge), a length of 1:30–3:15 and under 50 MB, every caption ending with a full stop (or ?, !, …, :), and a numbers check after the scenes: clip 1 Kavya's
balances after borrowing, rescheduling and declining; clip 2 Rohan's notice amount against his schedule and Meera
terminated; clips 2 and 3 the activity log's hash chain (verified by the app itself).

**Dates and time-dependent states**

- Clip 1 needs all of Kavya's stays in one membership year, at least 7 working days ahead. Recorded by about
  22 November it is December of this year, borrowing from next year, as in the storyboard; later in the year the seed
  moves everything to February of next year and the first scene shows that year's row on the Entitlement tab (the
  header always shows the current year).
- Clip 2: Rohan's overdue EMIs come from a purchase date about 4 months back and EMIs from about 45 days back (the API
  accepts past dates), then the app's own nightly overdue job, run once (`seed_clock.py mark-overdue`).
- Clip 2: Meera's default notice must be older than 14 days. `seed_clock.py default-notice` issues it through the
  app's own `issue_default_notice`, with "today" set 20 days back **for that one call only, in that short-lived
  process**: the API and worker always run on the real clock, and no table is edited by hand. It refuses to run
  against anything but the recording database `crm_video` (CRM_E2E_TARGET=true, CRM_ENV local or test). Afterwards the
  seed runs the activity-log integrity check and stops if it fails.
- Clip 3's KYC reveal hides itself after 30 seconds: the clip shows that with a real cut (`scene.cut`), the app's
  timer unchanged.

**Change a clip's caption**: the `d.caption("…")` calls in `src/clips.ts`; re-record that clip (`--clip N`). The title
card's subtitle is the clip title (`cards/title.html?sub=…`); the end card is the main video's.

## Voice-over later

`club8-crm-demo.srt` holds every caption with its start and end time on the final video. To add narration:

1. Use the SRT as the script: each caption is one line to read, and its time slot is how long the line may take.
2. Record the narration against the MP4 (any editor, or read along while playing it), and export one audio file.
3. Add it without re-encoding the picture:
   `ffmpeg -i club8-crm-demo.mp4 -i voice.m4a -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -shortest club8-crm-demo-voice.mp4`
4. If a line needs more time, lengthen that step's pause in `src/record.ts` and re-record the section.

The SRT can also be uploaded with the video (YouTube, Vimeo) as closed captions.
