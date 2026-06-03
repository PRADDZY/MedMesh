# MedMesh Handoff

MedMesh Handoff is a local-first mobile capture workflow for emergency and referral handoff. A field device captures structured intake, document photos, and a voice note; a nearby trusted peer laptop performs OCR, summarization, and protocol-grounded Q&A with `@qvac/sdk`.

## Why this fits QVAC

- Uses `@qvac/sdk` for local OCR, transcription, completion, and provider startup in `services/peer-core`.
- Keeps AI workloads local to the peer device and exposes a clear non-diagnostic clinical workflow.
- Ships a protocol pack, evidence log, export artifact, and peer console for judge-facing reproducibility.
- Supports a polished `emergency handoff` story with lighter `rural referral` and `specialist consult` presets.

## Workspace

- `apps/mobile` - Expo Android-first intake app
- `apps/peer-ui` - local web console for pairing, job status, and artifact review
- `services/peer-core` - Node peer service with mock/live QVAC runtime, evidence logging, and export flow
- `packages/shared` - shared contracts, presets, and disclaimers
- `packages/protocol-pack` - bundled local protocol references used for grounding
- `submission` - demo script, checklist, hardware proof, and disclosure notes

## Quick start

```powershell
pnpm install
pnpm --filter @medmesh/peer-core dev
pnpm --filter @medmesh/peer-ui dev
pnpm --filter @medmesh/mobile start
```

Default peer-core mode is `mock`, which keeps the demo runnable without downloading large models. For a live QVAC setup, copy `services/peer-core/.env.example` to `services/peer-core/.env` or export the same variables in your shell.

## Live QVAC mode

Set these before starting `peer-core`:

```powershell
$env:MEDMESH_QVAC_MODE='live'
$env:MEDMESH_LLM_MODEL_SRC='C:\models\qvac\MedPsy-1.7B-Q4.gguf'
$env:MEDMESH_WHISPER_MODEL_SRC='C:\models\qvac\whisper-tiny.bin'
$env:MEDMESH_OCR_MODEL_SRC='C:\models\qvac\ocr-detector.onnx'
$env:MEDMESH_EMBED_MODEL_SRC='C:\models\qvac\embed.gguf'
```

Optional:

- `MEDMESH_APP_URL` - LAN-accessible base URL for the mobile app
- `MEDMESH_PROVIDER_TOPIC` - fixed QVAC topic for delegated/provider pairing
- `MEDMESH_CTX_SIZE` and `MEDMESH_GPU_LAYERS` - tune for the demo laptop
- `MEDMESH_DEVICE_LABEL` and `MEDMESH_GPU_LABEL` - improve the hardware manifest shown in `peer-ui`

The service loads `.env` from the repo root and `services/peer-core/.env`, with the service-local file taking precedence.

## Demo flow

1. Start `peer-core` and open `peer-ui`.
2. On the phone, enter the peer URL and pairing code shown on the console.
3. Fill the emergency handoff fields, attach one or more document photos, and record a voice note.
4. Save locally once, then submit to peer.
5. Watch `peer-ui` show the job stages, summary, grounded answer, and export artifact.
6. Download the markdown export and capture the evidence log for submission.

Artifacts default to:

- `artifacts/evidence` - job markdown exports plus `events.jsonl`
- `data/peer-core` - persisted jobs and uploaded files

## Validation used here

- `pnpm typecheck`
- `pnpm build`
- Mock peer-core smoke test via `powershell -ExecutionPolicy Bypass -File .\scripts\mock-smoke.ps1`
- Live validation script via `powershell -ExecutionPolicy Bypass -File .\scripts\live-validate.ps1`
- Hardware capture helper via `powershell -ExecutionPolicy Bypass -File .\scripts\capture-hardware.ps1`

## Notes

- The mobile app currently uses manual peer URL + pairing code entry. The peer console already generates a QR payload, so QR scan onboarding can be added as a narrow follow-up after live proof is stable.
- `Build in Public` assets are intentionally not included in v1.
- This repo keeps a strict non-diagnostic boundary throughout the UI, exports, and peer service.
- A requested `live` run no longer silently masquerades as live if initialization fails; `/health` exposes requested mode, effective mode, model errors, and hardware metadata.
