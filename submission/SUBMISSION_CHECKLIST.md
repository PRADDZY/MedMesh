# Submission Checklist

## Requirements alignment

- `Open source` - repo includes a root `MIT` license and public README.
- `Uses @qvac/sdk` - wired in `services/peer-core/src/lib/qvac-runtime.ts`.
- `No cloud AI API dependency` - no remote AI services are configured or required.
- `Local / peer-local inference story` - phone capture app submits to nearby peer; peer can run mock or live QVAC mode.
- `Multimodal flow` - structured text, document photos, and voice note are all supported.
- `Artifact quality` - peer console, markdown export, and JSONL evidence log are included.
- `Reproducibility` - quick start, env example, demo script, and validation scripts are included.
- `Psy Models fit` - behavioral-health context and de-escalation grounding are built into intake and protocol pack.

## Before submission

- Set `MEDMESH_APP_URL` to a real LAN URL on the demo laptop.
- If running live, either use the pinned default QVAC sources or override them in `services/peer-core/.env`.
- Run `pnpm prepare:live` once before the final live demo so the official models are cached.
- Run `powershell -ExecutionPolicy Bypass -File .\scripts\mock-smoke.ps1` for a reproducible local sanity check.
- Run `powershell -ExecutionPolicy Bypass -File .\scripts\live-validate.ps1` after live prewarm or after any custom model override.
- Run `powershell -ExecutionPolicy Bypass -File .\scripts\capture-hardware.ps1` to save a hardware manifest under `artifacts/hardware`.
- Capture screenshots of:
  - mobile intake screen
  - peer console with pairing code
  - completed job summary
  - markdown export
  - hardware/model status
- Record a short demo video following `submission/DEMO_SCRIPT.md`.
- Export `artifacts/evidence/events.jsonl` after the final demo run.

## Honest current caveats

- Pairing is manual URL + code entry today; the peer console already emits a QR payload for the next step.
- The default repo mode is `mock` so the demo stays runnable without large local models.
- Live QVAC mode still needs a first-run model download or cache warmup, but it no longer depends on manually browsing for file paths before you can start.
- Embeddings are not used in the current lexical protocol search path, so `MEDMESH_EMBED_MODEL_SRC` is intentionally optional.
- This specific Windows environment currently fails QVAC live preflight because the upstream `bare-runtime-win32-x64` package is missing; MedMesh now reports that blocker cleanly instead of crashing.
