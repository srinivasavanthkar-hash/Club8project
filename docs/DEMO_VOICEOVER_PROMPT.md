# Voice-over Prompt: AI Narration for the Club8 CRM Demo Videos

## 0. Goal and rules

Add a natural **English voice-over** (Indian English voice) and light **background music** to the main demo video and the three follow-up clips. Produce it automatically with **Azure AI Speech**, so that every re-recording regenerates the narration in sync. Keep a **silent version** of every video as well.

Rules:
- **Build on the existing recorder** in `demo-video/`. The voice-over is a new step in the same pipeline, not a separate tool.
- **Captions stay.** Many people watch with the sound off, so the narration supplements the captions and doesn't replace them.
- **Three approval gates.** Stop and wait for me at each one:
  1. the narration script (Section 2);
  2. the voice choice (Section 3);
  3. the first voiced main video, before doing the three clips.
- **Secrets:** the Azure Speech key and region go in the git-ignored `.env` (e.g. `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`) or come from Key Vault, and are never committed or logged. Add the variable names, without values, to `.env.example`.
- Only the narration text is sent to Azure. It contains no personal data; all names in the demo are fictitious.
- Outputs go under `demo-video/out/` (gitignored). Commit code, the narration scripts and docs only, without Claude as a co-author.
- **Before writing code, show me a short plan** and wait for my approval.

## 1. Pipeline

1. **Narration script** per video, in `demo-video/narration/main.yaml`, `clip1.yaml`, `clip2.yaml` and `clip3.yaml`. Each line is anchored to a caption or step ID from the recorder, not to a fixed timestamp, so that it survives re-recording.
2. **Text-to-speech:** generate one audio file per line with Azure AI Speech using SSML. Cache the files by a hash of (text + voice + style + rate), so unchanged lines aren't re-generated or re-billed.
3. **Narration-driven pacing:** the recorder reads each line's audio length and holds that step for **max(caption minimum, narration length + 0.4 s)**. The video adapts to the voice, so lines never overlap or get cut off. Existing pacing rules still apply as minimums.
4. **Mixing (ffmpeg):** place each line at its anchor's time in the final video, add music under it, apply ducking and loudness normalisation, then mux with the existing video.
5. **Outputs:** a voiced and a silent version of each video.

## 2. Narration script (first approval gate)

Write a first draft of every narration file from the existing captions and storyboards, then **stop and show me the draft** as a readable table: section, anchor, caption, narration line, and estimated seconds.

Writing guidelines:
- **Voice:** warm, clear and confident, like a consultant walking a client through their new system. Use second person where natural ("Your sales team captures…").
- **Length:** one or two short sentences per step, roughly 2.5 words per second of the step's current length. If a line needs more time, the step gets longer (pacing above); keep the main video under **6:30** and each clip under **3:30**.
- **Purpose:** the narration adds the *why* that the caption can't. Example:
  - caption: "Confirming is refused: this year's ASF hasn't been paid yet."
  - narration: "Here the system stops the booking from being confirmed, because the agreement says no stay is confirmed until that year's subscription fee is paid."
- **Don't read out IDs, reference numbers or long figures.** Say "the member" or "this booking", not "M-S-M-C-8-9-0-0-2". Round amounts in speech ("about twelve thousand rupees plus GST") and leave exact figures to the screen.
- Use Club8's own terms: Annual Subscription Fee (the first time; "ASF" after that), Relationship Manager, nights, season, unit type.
- **No claims the app doesn't back up.** Every statement must match what's on screen.
- **Opening and closing:**
  - Title card: a one-line welcome, e.g. "This is the Club8 CRM — one system for Club8 Holidays and K8, from street lead to confirmed holiday."
  - End card: a one-line close plus the contact line from the end card.

## 3. Voice (second approval gate)

- List the available **Indian English neural voices** (`en-IN` locale) from the Azure Speech API; don't hard-code names from memory.
- Produce a **voice sample pack** in `demo-video/out/voice-samples/`: at least **two female and two male** voices, each reading the same three lines (the opening, the ASF-blocked line and the cancellation-outcome line), at speaking rates of 1.0 and 0.95.
- Send me the samples and wait for my choice of voice and rate. Save the choice in `demo-video/narration/voice.yaml`.

**Pronunciation lexicon,** applied through SSML (a `<lexicon>` or `<sub alias>`), in `demo-video/narration/pronunciation.yaml`:

| Text | Spoken as |
|---|---|
| Club8 | "Club Eight" |
| K8 | "K Eight" |
| ASF | "A S F" |
| EMI / EMIs | "E M I" / "E M Is" |
| GST | "G S T" |
| KYC | "K Y C" |
| 2FA | "two-step verification" |
| OPC | "O P C" |
| ₹12,600 | "twelve thousand six hundred rupees" (Indian numbering: lakh, not hundred thousand) |
| Demo names | Kavya, Ananya, Rohan, Meera, Arjun, Neel: check that each sounds natural, and fix any that don't |

## 4. Music

- **Optional,** and on by default for the voiced version only.
- Use one calm, instrumental, royalty-free track. Either I supply it, or you choose one from a source with a clear licence for commercial use (e.g. YouTube Audio Library or the Pixabay Content License). Record the track's title, source, licence and URL in `demo-video/README.md`. No tracks with an unclear licence.
- **Levels:**
  - music around −28 LUFS under the voice;
  - automatic **ducking** with sidechain compression, so the music drops about 10–12 dB while the voice is speaking;
  - 2-second fade-in on the title card and fade-out on the end card.

## 5. Mix and encode

- **Final loudness:** −16 LUFS integrated, true peak ≤ −1.5 dBTP (two-pass `loudnorm`).
- **Audio:** AAC 160 kbps, 48 kHz, stereo. The video stream is copied unchanged (H.264, `yuv420p`, limited range), with `+faststart`.
- **Outputs**, for each video:
  - `…-voiced.mp4` (voice and music);
  - `…-silent.mp4` (no audio track; identical to today's output);
  - `…-narration.srt` (the narration text with its actual timings; useful for translation later);
  - `…-narration.wav` (voice only, for anyone editing by hand).
- The existing caption `.srt` stays unchanged.

## 6. Quality check

Report on each item:
- **No overlaps:** no narration line overlaps the next, and none runs past its section.
- **No cut-offs:** no line is cut off at a section join (check 300 ms either side of each crossfade).
- **Loudness:** the measured loudness and true peak of each voiced file are within the targets above.
- **Script accuracy:** run Azure speech-to-text over the voiced narration and compare it with the script. Report any line with a word error rate above 10%, which usually points to a pronunciation problem to fix in the lexicon.
- **Pronunciation:** spot-check that "Club Eight", "K Eight", "A S F" and rupee amounts are spoken correctly.
- **Lengths:** the main video is under 6:30, each clip under 3:30, and each voiced file under 60 MB.
- **Visual QC:** all earlier visual QC checks still pass (captions, no skeletons under captions, no real data).

Then send me the voiced main video for the third approval gate before doing the clips.

## 7. Docs

Add a "Voice-over" section to `demo-video/README.md`, covering:
- how to edit a narration line and regenerate only that line (cached audio is reused);
- how to switch voice or rate;
- how to turn music off;
- how to produce a Hindi or Kannada version later: a translated `narration/<lang>/*.yaml` with an `hi-IN` or `kn-IN` voice, using the same pipeline.
