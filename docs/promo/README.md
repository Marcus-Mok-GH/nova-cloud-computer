# Promo videos

The finished Nova promo videos, plus every script that produced them. The
videos are the deliverables; `tools/` is the pipeline that cut, narrated,
scored and captioned them, kept here so any of them can be rebuilt or
extended rather than re-derived from scratch.

## Videos

| File | Length | What it is |
| --- | --- | --- |
| `nova-cloud-computer-demo.mp4` | 1:47 | Short product demo: sign in, workspace overview, agent running a job, files, deploy. |
| `nova-cloud-computer-demo-subtitled.mp4` | 1:47 | Same cut with burned-in captions. |
| `nova-cloud-computer-full-demo.mp4` | 2:04 | Extended demo with the integrations and automations beats. |
| `nova-cloud-computer-full-demo-subtitled.mp4` | 2:04 | Same cut with burned-in captions. |
| `nova-cloud-computer-walkthrough.mp4` | 5:00 | Complete walkthrough: app tour, environment variables, automations, API keys, API docs, end card. |
| `nova-cloud-computer-walkthrough-subtitled.mp4` | 5:00 | Same cut with burned-in captions (46 caption blocks, one per narration line). |

Published: the walkthrough is on YouTube — https://www.youtube.com/watch?v=y7Xs7QpYuSg
("Nova Cloud Computer — Complete Product Walkthrough (2026)", 15 chapters,
published 23 Nov 2026).

## How they were made

One pipeline, five stages, each stage its own script so a single scene can be
re-cut without re-cutting the film.

1. **Capture** — Playwright drives the real product in Chromium and records
   each scene as frames/segments: `record*.py`, `shoot_*.py`, plus scripted
   runs (`dry_tour.py`, `finish_onboarding.py`, `dry_run_approval.py`).
   `redact_email.py` pixelates the account email before anything ships — no
   address is ever left in frame.
2. **Narration** — `script_pro.py` holds the script; `make_narration*.py`
   synthesises each line with edge-tts (`en-US-BrianNeural`, rate `-3%`),
   trims the trailing silence the API pads on, and places the lines on the
   timeline with a tail reserve and a gap check, so nothing overlaps.
   `gen_voice*.py` are the per-line probes; `build_audio.py` mixes the bed.
3. **Graphics** — Pillow-rendered overlays and cards: `gen_overlays*.py`
   (the cream/coral overlay cards), `gen_endcard.py` / `gen_nova_endcard.py`
   (the orb end card with the beta → 1.0 reveal), `gen_music*.py` /
   `gen_jazz.py` (the calm smooth-jazz bed).
4. **Assembly** — ffmpeg composition: `build_video*.py`, `build_walk.py`,
   `build_final*.py` — scene order, crossfades between scenes, the
   fade-to-black bridge into the outro, audio ducking (music ~4 dB under the
   voice), and `add_subtitles.py` for the burned-in captions.
5. **QA** — `verify_walk.py`, `verify3.py`, `probe*.py`, `peek*.py`,
   `check_state.py`, `dbg_settings.py`: speech-vs-picture sync audits, frame
   and caption counts, and the checks that a section actually shows what the
   narration claims.

`tools/` holds all 63 scripts, grouped by that pipeline (20 capture, 12
narration, 8 graphics, 8 assembly, 15 QA).

## Rebuilding

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r docs/promo/tools/requirements.txt
```

- **ffmpeg/ffprobe** must be on the machine. The build scripts point at a
  pinned local build via the `FFMPEG` constant near the top of each
  `build_*.py` — repoint it at your own binary before running.
- **Capture needs the app running** and a Chromium that Playwright can
  drive. Each recorder writes its timing marks to a `*-marks.json`, and the
  build scripts load those marks to place the cuts — so re-timing a scene
  is a re-record plus a rebuild, never a hand edit of the timeline.
- **A saved login session and API keys are deliberately absent.** Recording
  scripts read them from the environment / a local session file that is not
  committed here, and no key is embedded in any script in this directory.

## Not committed

The ~950 MB of intermediates these scripts emit — raw clips, audio stems,
frame dumps, QA screenshots, `__pycache__` — stays local. Only the six final
videos and the scripts are versioned.