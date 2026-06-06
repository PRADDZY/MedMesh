# Submission Checklist

## Requirements alignment

- `Open source` - repo includes a root `MIT` license and public README.
- `Uses @qvac/sdk` - live OCR, live transcription, provider startup, and model orchestration are wired through `services/peer-core`.
- `No cloud AI API dependency` - no remote AI services are configured or required.
- `Local / peer-local inference story` - phone capture app submits to a nearby Windows peer that runs the approved local QVAC flow.
- `Multimodal flow` - structured text, document photos, and voice note are all supported.
- `Artifact quality` - peer console, markdown export, doctor report, validation JSONs, and JSONL evidence log are included.
- `Reproducibility` - quick start, env example, demo script, doctor script, qualification script, and frozen assets are included.
- `Honest scope` - the approved current-laptop path uses the `lite` live profile: live Whisper + OCR, deterministic local summary/grounded assembly, non-diagnostic workflow support.

## Before submission

- Run `pnpm doctor:live` and keep `artifacts/validation/live-doctor.json`.
- Run `pnpm qualify:live-host:dry` on this laptop and confirm `candidate-live-host` or better.
- Run `pnpm qualify:live-host` on this laptop and confirm `qualificationStatus=approved` before the final demo.
- Set `MEDMESH_APP_URL` to a real LAN URL on the laptop when recording the phone demo.
- Run `powershell -ExecutionPolicy Bypass -File .\scripts\mock-smoke.ps1` for a reproducible fallback sanity check.
- Run `pnpm validate:live` and confirm the final report includes `documentCount >= 1` and `hasVoiceNote = true`.
- Run `pnpm freeze:submission-assets` after the approved live run.
- Run `pnpm submission:check` before submitting; it should only stay blocked on screenshots/video until those manual assets are finished.
- Keep these generated artifacts:
  - `artifacts/validation/live-doctor.json`
  - `artifacts/validation/live-host-qualification.json`
  - `artifacts/validation/live-health.json`
  - `artifacts/validation/live-validation.json`
  - `artifacts/hardware/hardware-summary.json`
  - `artifacts/evidence/events.jsonl`
  - `submission/final-assets/approved-export.md`
  - `submission/final-assets/freeze-manifest.json`
- Confirm `submission/final-assets/events.jsonl` only contains the approved live job, not earlier mock runs.
- Capture screenshots of:
  - `submission/final-assets/screenshots/mobile-intake.png`
  - `submission/final-assets/screenshots/peer-console-runtime.png`
  - `submission/final-assets/screenshots/peer-console-pairing.png`
  - `submission/final-assets/screenshots/peer-console-summary.png`
  - `submission/final-assets/screenshots/peer-console-grounded-answer.png`
  - `submission/final-assets/screenshots/completed-export.png`
  - `submission/final-assets/screenshots/hardware-model-status.png`
- Record a short demo video following `submission/DEMO_SCRIPT.md`.

## Honest current caveats

- Pairing is manual URL + code entry today.
- The approved live profile on this machine is `lite`, not `full`.
- `full` mode remains opt-in for stronger hardware and is not part of the current approved evidence bundle.
- The automated live validator now exercises document + voice attachments by default, but the final demo video should still include real phone-captured photos/audio for the strongest judge evidence.
