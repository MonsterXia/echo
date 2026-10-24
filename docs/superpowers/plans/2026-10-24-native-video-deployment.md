# Native video automatic deployment

User authorization: continue the approved Node/TypeScript H.264 route and make phones without a preinstalled library work; no Java runtime.

Design: pin the official HOScrcpy v1.0.16-beta release's SDK 1.0.18 archive and six small signed ARM64 unix-service libraries by SHA-256. Node extracts only those entries at resource preparation time; the application package contains only native libraries and notices, not the JAR. On a supported ARM64/UITest device, validate local resources, upload a candidate to a unique session filename, check the remote hash, and probe the existing H.264 service. Stop and confirm cleanup before trying the next candidate. Remember a successful candidate for this driver. Each session is redeployed and removed on stop; do not overwrite the existing third-party library or leave permanent device caches. Unsupported devices retain JPEG.

Evidence affecting selection: all six official candidates were tested without replacing the phone's original library. Only `libscrcpy_server_unix_6.6-20260418.z.so` started on this device; the newest 20260629 candidate did not. Use bounded ordered probes, not an inferred OS-version-to-kernel mapping. The official archive exactly matches the previously inspected SDK archive.

- [x] Add manifest, upstream license/notice and Node-only resource extraction with digest/entry bounds tests; include native resources in distribution.
- [x] Add supported-device selection, local ELF/digest validation, verified upload and candidate retry/cleanup; cover failure, reuse and preinstalled independence.
- [x] Exercise real production client with original library temporarily absent and restore it in finally; verify deployed-library decode, restart and cleanup. Parent recovery journal also covers child timeout.
- [x] Run applicable tests/builds, fresh review, update architecture/README/RUNBOOK and actual acceptance limits.

Evidence: [deployment acceptance](../../maintenance/native-video-deployment.md), [device counters](../../maintenance/screencast-native-deployment.json). Application tests 501/501, both Licia modes 606 passing / 4 pending, lint/full build and Electron lifecycle 8/8 passed. Fresh review findings about ambiguous HDC cleanup, interrupted probe restoration and stale JAR packaging were fixed with regression coverage. Final deployed stream drew 34.26 FPS with the original library absent; scaling, reopen, cleanup and restoration passed. Cross-firmware and installer acceptance remain unverified.

No commit, push or release requested. Preserve existing workspace changes. Physical clean-device equivalence is tested by removing only this library from its lookup location temporarily; this does not imply a factory-reset phone or all firmware variants have been tested.
