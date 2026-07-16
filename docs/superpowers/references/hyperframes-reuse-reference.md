# HyperFrames + ffmpeg + silencedetect reuse brief (from `book-video`)

Source clone: `.../scratchpad/book-video`. Purpose: reuse the *technical骨架* (HyperFrames render → ffmpeg mux → silencedetect timing) for a NEW book-list template. Do NOT reuse book-video's templates/SOP.

Pinned tool version everywhere: **`hyperframes@0.7.33`**, always invoked via `npx --yes hyperframes@0.7.33 <cmd>`.

---

## 1. HyperFrames template anatomy

### What a template folder needs
A HyperFrames "project" is just a directory that HyperFrames runs `preview`/`render` against (cwd = that dir). The concrete one is `templates/shared-video-template/intro/`:

```
intro/
  index.html          # the composition (required)
  package.json        # npm scripts wrapping hyperframes commands
  media/              # relative-referenced assets: intro-background.jpg, pages/scroll-01..06.jpg, result.png
  default-book-list.json   # book-video-specific data (NOT read by HyperFrames — read by the render script)
  README.md
```
`body/` in the repo is only a `media/` + README stub — the **real body project is generated at render time into `tmp/preview-<slug>/body/`** by `create-episode-preview.mjs` (writes `index.html` + `package.json`).

### How the composition + timeline are declared (this is the HyperFrames contract)
Two mechanisms, both inside `index.html`:

1. **Root element `data-*` attributes** declare the composition frame:
   ```html
   <main id="root" data-composition-id="main"
         data-start="0" data-duration="4.25" data-width="720" data-height="960">
   ```
   - `data-composition-id` — name of the composition (matches the timeline key, see below).
   - `data-start` / `data-duration` — timeline window in **seconds**.
   - `data-width` / `data-height` — pixel canvas (also mirrored in `<meta name="viewport" content="width=720, height=960">` and `html,body{width/height}`).
   - fps is **not** in the HTML. Output is 30fps (playbook §固定输出规则 "720x960, 30fps"); fps comes from HyperFrames' `--quality standard` render preset, not the template.

2. **A paused GSAP timeline registered on `window.__timelines[<composition-id>]`** — HyperFrames imports GSAP from CDN (`gsap@3.14.2`), builds a `gsap.timeline({ paused: true })`, and hands it over:
   ```js
   window.__timelines = window.__timelines || {};
   var tl = gsap.timeline({ paused: true });
   tl.fromTo(".intro-caption", {opacity:0,y:18}, {opacity:1,y:0,duration:0.22,ease:"power3.out"}, 0.12);
   // ...more tweens, positioned at absolute seconds...
   window.__timelines["main"] = tl;
   ```
   HyperFrames renders by **seeking this timeline to each frame's time and screenshotting** the DOM. Keyframes = GSAP tweens; the 3rd positional arg of each tween is its absolute start time in seconds. There is NO separate keyframe JSON — the timeline *is* the animation spec.

3. **`data-layout-ignore`** on an element tells HyperFrames' layout pass to skip it (used on absolutely-positioned overlay/animated layers so they aren't auto-laid-out).

### How the template receives its DATA (important — no runtime data source)
HyperFrames renders a static HTML file; **it does NOT fetch a JSON, read an env var, or hydrate at runtime.** Data binding is done by the render pipeline *before* HyperFrames runs, in `create-episode-preview.mjs`:
- **Intro template**: uses `{{MUSTACHE}}` tokens (`{{TARGET_TITLE}}`, `{{TARGET_AUTHOR}}`, `{{LIST_TITLE_1..6}}`, `{{LIST_AUTHOR_1..6}}`). The script does `html.replaceAll("{{TARGET_TITLE}}", ...)` etc., and even rewrites whole element tags to inject inline `style="font-size:..."`. Images are bound by **copying files to fixed relative paths** (e.g. `result-bridge.png` → `media/pages/result.png`).
- **Body template**: has NO placeholders in the repo — the entire `index.html` (styles, N `.cN` caption divs, GSAP `revealCaption(...)` calls) is **generated as a template-literal string** in `createBody()` and written to `tmp/.../body/index.html`.

So the "data contract" for reuse is: **your pipeline bakes data into HTML (token-replace or full codegen) + copies images to known relative paths, then runs HyperFrames on that folder.**

### Animation techniques used (crossfade / slow-zoom / "缓推近")
All pure GSAP + CSS, driven off the timeline (from generated body `index.html`):
- **Slow push-in (缓推近)**: tween `scale` on a `.photo` div that is `position:absolute; inset:-22px; background-size:cover`, e.g.
  `tl.fromTo(".s1 .photo", {scale:1.035,x:8,y:-4}, {scale:1.105,x:-16,y:12, duration:<sceneLen+1.2>, ease:"sine.inOut"}, 0);` — long duration + slight x/y drift = Ken-Burns.
- **Crossfade**: overlapping opacity tweens at the same start time — fade next scene in while fading current out:
  `tl.fromTo(".s2",{opacity:0},{opacity:1,duration:0.72,ease:"sine.inOut"}, sceneTwo);`
  `tl.to(".s1",{opacity:0,duration:0.72,ease:"sine.inOut"}, sceneTwo);`
- **Caption reveal**: `revealCaption(sel,start,hold)` does a `fromTo` (opacity/ y / scaleX) at `start`, then `tl.set(sel,{opacity:0}, start+hold)` to hide.
- Intro uses fancier 3D `clip-path` glass shards (`.p1..p15`, `rotationX/Y/z`, `perspective:900px`) — not needed for our simpler template.

### Render output
`npx hyperframes@0.7.33 render --quality standard --output renders/body.mp4` (run with cwd = the project dir) writes an mp4 to the `--output` path relative to cwd. Resolution = `data-width`×`data-height` (720×960), 30fps, **video-only, no audio** (audio is muxed later by ffmpeg). `--quality standard` is the encode preset.

---

## 2. Exact commands (pinned 0.7.33)

From `intro/package.json`:
```jsonc
"dev":    "npx --yes hyperframes@0.7.33 preview",            // live preview server
"check":  "npx --yes hyperframes@0.7.33 lint && npx --yes hyperframes@0.7.33 validate && \
           npx --yes hyperframes@0.7.33 inspect --at 0.2,0.75,1.2,1.7,2.08,2.25,2.55,3.2,3.8,4.15",
"render": "npx --yes hyperframes@0.7.33 render"
```
- **preview**: `npx --yes hyperframes@0.7.33 preview`
- **lint**: `npx --yes hyperframes@0.7.33 lint`
- **validate**: `npx --yes hyperframes@0.7.33 validate`
- **inspect** (render still frames at given seconds for QA): `... inspect --at <t1,t2,...>`
- **render** (production, from `render-episode-final.mjs`):
  `npx --yes hyperframes@0.7.33 render --quality standard --output renders/<name>.mp4` (cwd = project dir)
- Repo-level `npm run check` runs the same lint/validate/inspect gate. If npm registry is blocked on first use, escalate to network and retry (AGENTS.md §Startup 3).

---

## 3. silencedetect → body_timings algorithm

Driver: `scripts/create-body-timings.mjs`; pure logic in `scripts/lib/body-timings.mjs`. Goal: turn a voiceover MP3 into N `{order,start,end}` caption windows aligned to the N script rows. (`script.csv` text is subtitle truth; ASR/silence only give *timing*.)

**Defaults** (`readOptions`): `skipLeading = 1`, `noise = "-35dB"`, `silenceDuration = "0.18"` (overridable via `--skip-leading`/`--noise`/`--silence-duration`).

**Steps:**
1. Whisper ASR for reference JSON (not used for timing math, kept as provenance):
   `whisper-cli -ng -m assets/models/whisper/ggml-base.bin -l zh -oj -otxt -of <asrBase> <voice.mp3>`
2. Total duration via ffprobe:
   `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <voice.mp3>`
3. **silencedetect** (the key command):
   ```
   ffmpeg -hide_banner -i <voice.mp3> -af silencedetect=noise=-35dB:d=0.18 -f null -
   ```
   (reads noise/duration from options). Output scraped from combined stdout+stderr.
4. `parseSilenceEvents(output)` — regex `/silence_(start|end):\s*([0-9.]+)/g` → list of `{type:"start"|"end", time}`.
5. `buildSpeechSegments(duration, events)` — invert silences into **speech** segments:
   - start speechStart=0, walk events; on a `silence_start` (while speaking) close a segment `{speechStart, event.time}`; on `silence_end` set `speechStart = event.time`.
   - after loop, if not in silence, push `{speechStart, duration}`.
   - **drop segments shorter than 0.08s.**
6. `coalesceSpeechSegments(segments, targetCount)` where `targetCount = rows.length + skipLeading`:
   - while `segments.length > targetCount`: find the adjacent pair with the **smallest gap** (`next.start - cur.end`) and merge them into one `{cur.start, next.end}`. Repeats until exactly targetCount segments remain. (Greedy merge of the tightest pauses — assumes silencedetect over-splits.)
7. `buildCaptionTimings(orders, segments, skipLeading)`:
   - `selected = segments.slice(skipLeading, skipLeading + orders.length)` (skip the leading spoken title/author segment).
   - **throws** if `selected.length !== orders.length` ("Speech segment count mismatch… adjust --skip-leading or the silence settings").
   - emits `{ order:Number, start:round2, end:round2 }` per row.
8. Write `audio/body-timings.json`:
   ```json
   { "scriptVersion","duration", "source":"whisper-cli + ffmpeg silencedetect; script.csv remains subtitle truth",
     "audio","asr","skipLeadingSegments", "silence":{"noise","duration"},
     "captions":[{"order","start","end"}, ...] }
   ```
Downstream (`create-episode-preview.createBody`): each row picks its caption by `order`; `end = max(start+0.8, end)` (min 0.8s hold), converted to `{start, hold=end-start}` for the GSAP `revealCaption` call. If timings are absent it falls back to `duration_hint` cursor advancing.

---

## 4. Final mux ffmpeg filter chains (`render-episode-final.mjs`)

Inputs (in order): `[0]` intro video, `[1]` body video, `[2]` intro voiceover (story-processed), `[3]` body voiceover (story-processed), `[4]` BGM (`-stream_loop -1` before it → infinite loop), `[5]` intro scroll SFX.

Key constants: `INTRO_TRIM_SECONDS=2.38` → `INTRO_OFFSET_MS=2380`; `FINAL_BGM_BASE_VOLUME=0.32` (× `10^(FINAL_BGM_GAIN_DB/20)`, default gain 0 → 0.32); SFX volume `1.4`, window 1.08→2.38s.

**Video**: trim each clip and concat:
```
[0:v]trim=0:2.38,setpts=PTS-STARTPTS[v0]
[1:v]trim=0:<bodyDuration>,setpts=PTS-STARTPTS[v1]
[v0][v1]concat=n=2:v=1:a=0[v]
```
(intro is trimmed to 2.38s — the moment the target-book result page settles — so body's first frame `result-bridge` continues seamlessly.)

**Audio** (exact filter strings):
```
[2:a]aresample=48000,volume=1.0[introa]
[3:a]aresample=48000,adelay=2380|2380,volume=1.0[bodya]
[4:a]atrim=0:<finalDuration>,asetpts=PTS-STARTPTS,aresample=48000,volume=<FINAL_BGM_VOLUME>[bgm]
[5:a]atrim=0:<sfxDur>,asetpts=PTS-STARTPTS,aresample=48000,volume=1.4,afade=t=in:st=0:d=0.01,afade=t=out:st=<fadeStart>:d=0.2,adelay=1080|1080[scrollsfx]
[introa][bodya][bgm][scrollsfx]amix=inputs=4:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,loudnorm=I=-14.0:TP=-1.0:LRA=7.0,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a]
```
Notes:
- **Body voiceover delayed by 2380ms** (`adelay`) so it starts exactly when the intro trim ends.
- **BGM ducking is static, not sidechain**: BGM held at fixed low `volume=0.32`; loudness is finalized by **`loudnorm=I=-14.0:TP=-1.0:LRA=7.0`** (streaming-standard -14 LUFS). `amix … normalize=0` prevents auto gain-drop; `alimiter=limit=0.95` catches peaks before loudnorm.
- Encode: `-c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.1 -c:a aac -b:a 192k -movflags +faststart -shortest`.
- Post-checks (`probeVideo`): must be 720×960, must have audio, duration >0 and ≤60.05s (unless `ALLOW_OVER_60_SECONDS=1`).

**Voiceover pre-processing** (`process-voiceover.mjs`, `story` preset — run on each voiceover *before* the mux):
```
highpass=f=70, lowpass=f=14500,
equalizer=f=180:g=-1.0, equalizer=f=950:g=1.2, equalizer=f=3100:g=2.0, equalizer=f=7200:g=0.8,
acompressor=threshold=-24dB:ratio=3.0:attack=8:release=160:makeup=4,
alimiter=limit=0.92,
loudnorm=I=-14.0:TP=-1.0:LRA=4.0
```
via `ffmpeg -y -i in.mp3 -vn -af <chain> -codec:a libmp3lame -b:a 192k out.mp3`.

---

## 5. validate-script logic (`scripts/lib/script-policy.mjs` + `validate-script.mjs`)

Constants: `MAX_BODY_SCRIPT_LINES = 21`, `MAX_BODY_SCRIPT_CHARS = 220`.

`validateBodyScript(rows)`:
- `lines = rows.length` (rows already filtered to the active `version` and sorted by `order`).
- `chars = Array.from(rows.map(r => String(r.text||"")).join("")).length` — concatenates all row texts and counts **code points** (`Array.from` → correct for CJK/emoji), i.e. total body character count across all lines.
- errors: push if `lines > 21` ("正文最多 21 行…") and/or if `chars > 220` ("正文最多 220 个汉字…").
- returns `{ lines, chars, errors }`.

`validate-script.mjs`: reads `episodes/<book>/script.csv`, parses CSV (custom quote-aware parser), filters rows to the resolved version, sorts by order, throws if none, prints `{episode,scriptVersion,lines,chars,errors}` JSON, and **exits 1 if `errors.length`**. Per playbook/AGENTS this gate runs at drafting time — over-limit drafts must be shortened internally and re-validated, never shown to the user or deferred to render. (Whole-script guidance: target 18–20 total lines incl. title, hard cap 22 total incl. title.) The same `validateBodyScript` is also re-checked inside `create-body-timings.mjs` and `create-episode-preview.mjs` as a render-blocking safeguard.

---

## 6. Proposed data-contract for OUR new template

book-video bakes data into HTML via token-replace/codegen with images copied to fixed relative paths. For our product we keep the same骨架 but formalize a **single JSON the body `index.html` consumes**, and keep the pipeline responsible for copying images into the project's `media/` before render. (HyperFrames still won't fetch it at runtime — our render script codegens/hydrates the HTML from this JSON, exactly like `createBody()`.)

### Proposed `body-data.json` shape
```jsonc
{
  "fps": 30,
  "size": { "width": 720, "height": 960 },      // → data-width/height + viewport + html/body
  "overlay": {                                   // 常驻层 (persistent, data-layout-ignore)
    "title": "《书名》",                          // 标题卡片 book title
    "subtitle": "作者 / 著",                      // subtitle
    "watermark": "@账号名"                        // watermark, always on
  },
  "images": [                                    // 8–10 carousel images, crossfade per segment
    { "src": "media/01.png" }, { "src": "media/02.png" }, ...
  ],
  "segments": [                                  // one per sentence, from body_timings
    { "seqNo": 1, "startMs": 2380, "endMs": 4120, "subtitle": "第一句字幕文本", "imageIndex": 0 },
    { "seqNo": 2, "startMs": 4120, "endMs": 6050, "subtitle": "第二句", "imageIndex": 1 },
    ...
  ]
}
```
Design choices vs book-video:
- **Times in ms** (Prisma stores ms), converted to seconds when emitting GSAP tween positions (`startMs/1000`). book-video used seconds throughout — pick one and stay consistent.
- **`segments` drive BOTH the subtitle layer and the image crossfades.** book-video coupled scene count (3) to time fractions; we instead crossfade image `imageIndex` at each segment boundary so 8–10 images map cleanly onto the N caption windows (e.g. `imageIndex = floor(i * images.length / segments.length)` if you want fewer images than segments, or 1:1).
- **`overlay.watermark`** is the new persistent element book-video deliberately forbids (it bans visible watermarks); we render it as a fixed `position:absolute` layer with `data-layout-ignore`, always opacity 1.
- Render composition: `<main data-composition-id="main" data-start="0" data-duration="<lastSegment.endMs/1000>" data-width data-height>`; total duration = last segment end.

### Mapping to our Prisma models
- `generation_tasks.body_timings` → the **`segments[]` array** (each `{seqNo, startMs, endMs}`), produced by our own silencedetect step (§3 algorithm: `silencedetect=noise=-35dB:d=0.18` → invert → coalesce to N=sentence count, `skipLeading` for any spoken intro). This is the timing source of truth.
- `generated_segments.image_url` → copied into the project as `media/<NN>.png` and referenced by `images[].src`; `generated_segments.script_text` → `segments[].subtitle` (the on-screen sentence, our subtitle truth analogous to `script.csv`). `generated_segments.seqNo`/order → `segments[].seqNo`, joined to a `body_timings` window by order.
- `copy_frameworks.overlay_template` → the `overlay` object (title/subtitle/watermark strings, possibly a small template with substitution slots) — the persistent title-card + watermark spec.

### Reusable pipeline skeleton (what to copy conceptually)
1. `validate-script` gate (line/char caps as our own thresholds) before anything renders.
2. voiceover → `story` ffmpeg preset (§4) → silencedetect → `segments` timing JSON (§3).
3. codegen body `index.html` from `body-data.json` (GSAP paused timeline on `window.__timelines["main"]`, crossfade + 缓推近 tweens, `revealCaption` per segment, persistent overlay layer) + copy images to `media/`.
4. `npx hyperframes@0.7.33 render --quality standard --output renders/body.mp4` (video-only).
5. ffmpeg mux: concat visuals, `adelay` voiceover, `volume=0.32` looped BGM, `amix …normalize=0`, `alimiter=0.95`, `loudnorm=I=-14:TP=-1:LRA=7`, x264 high/yuv420p/+faststart, `-shortest`; ffprobe-verify dims/audio/≤60s.
```
