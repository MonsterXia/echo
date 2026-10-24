# Native video implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task.

**Goal:** Improve this device's screencast using native H.264 without Java.
**Architecture:** Existing session ownership drives a Node HTTP/2 native capture adapter. Chromium WebCodecs draws decoded frames into the existing canvas. JPEG remains the compatibility path.
**Tech Stack:** TypeScript, Node HTTP/2, existing HDC, Electron WebCodecs.
**Spec:** [approved design](../../maintenance/screencast-video-design.md); user selected TypeScript/Node.js.

## Global constraints

No JVM or new desktop runtime. Do not overwrite device libraries. Do not claim unverified native library variants are distributable. Preserve session/generation ownership and touch coordinate spaces.

## Review focus

- Incomplete or oversized gRPC/protobuf inputs: reject without growing memory indefinitely.
- Decoder overload or missing keyframe: wait for a keyframe rather than corrupting reference frames.
- Closing during native startup: clean up only this session's transport and process.
- Native resource unavailable: retain working JPEG capture and report compatibility mode.
- Rotation/scale change: invalidate old decode output and refresh physical touch dimensions.

## Tasks

- [x] Add failing tests and implement bounded gRPC/protobuf parsing in `src/main/lib/hdc/nativeVideoProtocol.ts`; test packet splitting, payload fields and invalid lengths.
- [x] Add failing tests and implement `H264Decoder` in `src/renderer/screencast/lib/H264Decoder.ts`; test SPS/keyframes, decoder queue bounds and disposal.
- [x] Implement `nativeVideo.ts` transport and lifecycle using existing device library; add local HTTP/2 tests for start/stop/errors. Integrate through `captureDriver.ts`, `captureSessions.ts` and `ScreencastClient.ts` with explicit codec metadata.
- [x] Run application tests, lint, main/preload/renderer builds and real Electron/device frame counters. Record deployment limits and remaining validation in RUNBOOK and references.

## Execution record

- Protocol tests: 4 passing; decoder tests: 4 passing, including SPS changes and late output disposal. JPEG parser and latest-frame regressions observed failing before correction.
- Native local HTTP/2 and lifecycle tests: 8 passing; renderer/session regressions cover fallback, closing during startup, stale generations, bounded decoded-frame ownership and uncertain stop.
- Final fresh-context review: three Important findings (mapping absence, config-only first frame, reused probe mapping) fixed. Mapping and config-only regression tests observed RED→GREEN; probe forwarding ownership regression passes. The probe validation gap was treated as acceptance correctness: native codec and actual resized/new frames are now required, followed by another real-device run.
- Final application suite 488/488; lint and all three application builds pass. Electron synthetic window lifecycle 8/8; real device integrated client 34.37 FPS for both receipt/draw over 15 seconds, native scale restart/reopen/cleanup successful. Only counters archived.
- Existing signed device library remains unchanged; no owned native process or forwarding rule remains after final probe. No Java runtime or new desktop dependency introduced.
- Remaining: redistributable native resources/clean-device install, real rotation and physical reconnect, long-run performance/latency and cross-platform package acceptance. These remain explicitly unverified, not blockers to the measured current-device improvement.

No commit/push/release requested. Leave changes reviewable in the current checkout.
