# Repository review — 2026-10-24

The review covered the local Express API, video input handling, composition generation, apply/render recovery, browser workflow, dependencies, CI, and repository configuration.

## Fixes

- Restricted static routes to intended outputs, preventing downloads of server source, package metadata, tests, and backups.
- Rejected foreign hosts and cross-origin browser requests to the local server.
- Pinned HTTPS connections to validated public DNS addresses, rejected private and mapped addresses, and revalidated redirects.
- Closed response streams and file handles on download failures and removed incomplete analysis outputs.
- Serialized apply/render jobs, including when the requesting client disconnects.
- Added atomic composition replacement, explicit recovery errors, partial-render cleanup, unique backups, and portable render paths.
- Validated AI style profiles and video durations before composition generation.
- Corrected caption timing to follow transcript segments, split long segments into groups of up to six words, and kept captions above footage.
- Honored explicit aspect ratios, disabled captions/punch-ins, and silent source videos; removed invented fallback captions.
- Blocked conflicting UI actions during processing, cleared stale results, and added rendered-video playback and MP4 downloads.
- Loaded configuration relative to the server, validated port and upload limits, declared Node.js 22+, updated CI installation and branch coverage, and ignored future local media/cache outputs.
- Updated the README to describe the actual automatic workflow.

## Validation

- `npm test`: 18 tests pass, including HTTP access checks, DNS pinning, job locking, failed-render recovery, caption generation, and browser workflow behavior.
- `node --check server.mjs`: passes.
- `npm audit --omit=dev`: zero known vulnerabilities reported.
- `npm run check -- --snapshots`: passes with zero lint, runtime, layout, motion, or contrast errors. Five review frames were captured; the 7.8 s and 70.3 s frames were visually inspected.
- `git diff --check`: passes.

## Remaining limits

HyperFrames reports 54 editorial `line_unread` warnings on the existing 140.5-second composition. Short captions follow fast speech, and the final spoken line lasts less than the tool's preferred two seconds. These warnings are retained. Eliminating them would require retiming the footage or changing subtitle presentation. Group timing inside a long transcript segment is estimated because only segment timestamps are available.

Live Groq analysis and a new complete MP4 render were not run during this review. Rendering success and recovery paths were tested with controlled render callbacks; the active composition was validated in the HyperFrames browser runtime.

Existing unrelated working-tree changes were preserved. Ignore rules do not remove previously tracked media or cache files from Git history or the index.
