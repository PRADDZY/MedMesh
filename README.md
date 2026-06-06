# MedMesh Handoff

MedMesh Handoff is a local-first mobile capture workflow for emergency and referral handoff. An Android phone captures structured intake, document photos, and a voice note; a nearby trusted Windows laptop processes the case locally with `@qvac/sdk` and generates a grounded, non-diagnostic handoff packet.

## Why this fits QVAC

- Uses `@qvac/sdk` for live OCR, transcription, provider startup, and local model orchestration.
- Keeps AI workloads on the approved local peer with no cloud AI APIs.
- Ships evidence logs, exports, validation artifacts, and a peer console for reproducibility.
- Supports the main `emergency handoff` story with `rural referral` and `specialist consult` presets.
- Makes the approved `lite` profile explicit: live QVAC OCR + live QVAC Whisper on this 4 GB Windows laptop, with deterministic local summary and grounded follow-up for reliability.

## Workspace

- `apps/mobile` - Expo Android-first intake app
- `apps/peer-ui` - local web console for pairing, job status, and artifact review
- `services/peer-core` - Node peer service with mock/live QVAC runtime, evidence logging, and export flow
- `packages/shared` - shared contracts, presets, and disclaimers
- `packages/protocol-pack` - bundled local protocol references used for grounding
- `submission` - checklist, demo script, hardware proof, submission copy, and frozen assets

## Quick start

```powershell
pnpm install
pnpm --filter @medmesh/peer-core dev
pnpm --filter @medmesh/peer-ui dev
pnpm --filter @medmesh/mobile start
```

Default mode is `mock`, which keeps the product runnable without model downloads.

## Live QVAC mode

The current approved single-machine path is the `lite` live profile:

- live `Whisper` transcription
- live `OCR` extraction
- deterministic local summary and grounded answer assembly for reliability on this 4 GB Windows laptop

Run:

```powershell
$env:MEDMESH_QVAC_MODE='live'
pnpm doctor:live
pnpm qualify:live-host:dry
pnpm qualify:live-host
```

Current approved artifact on this laptop:

- `artifacts/validation/live-host-qualification.json` -> `qualificationStatus=approved`
- `runtime.liveProfile=lite`

If you later have stronger hardware, you can opt into the fuller profile:

```powershell
$env:MEDMESH_QVAC_MODE='live'
$env:MEDMESH_LIVE_PROFILE='full'
pnpm qualify:live-host
```

## Model sources

Default `lite` live sources:

- `WHISPER_TINY`
- `VAD_SILERO_5_1_2`
- `OCR_LATIN_RECOGNIZER_1`

Optional `full` profile additions:

- `MedPsy 1.7B Q4_K_M`
- custom embeddings if explicitly configured

Override any source with a local path, registry URI, or remote URL:

```powershell
$env:MEDMESH_LLM_MODEL_SRC='C:\models\qvac\custom-medpsy.gguf'
$env:MEDMESH_WHISPER_MODEL_SRC='C:\models\qvac\custom-whisper.bin'
$env:MEDMESH_VAD_MODEL_SRC='C:\models\qvac\custom-vad.bin'
$env:MEDMESH_OCR_MODEL_SRC='C:\models\qvac\custom-ocr.onnx'
$env:MEDMESH_EMBED_MODEL_SRC='C:\models\qvac\custom-embed.gguf'
```

Useful env vars:

- `MEDMESH_APP_URL` - LAN base URL for the phone
- `MEDMESH_PROVIDER_TOPIC` - fixed QVAC topic for delegated/provider pairing
- `MEDMESH_LIVE_PROFILE` - `lite` or `full`
- `MEDMESH_CTX_SIZE` and `MEDMESH_GPU_LAYERS` - tuning knobs for stronger hardware
- `MEDMESH_DEVICE_LABEL` and `MEDMESH_GPU_LABEL` - better hardware labeling in `peer-ui`

The service loads `.env` from the repo root and `services/peer-core/.env`, with the service-local file taking precedence.

## Demo flow

1. Run `pnpm qualify:live-host` and confirm `approved-live-demo-host`.
2. Start `peer-core` and open `peer-ui`.
3. On the phone, enter the peer URL and pairing code shown on the console.
4. Fill the emergency handoff fields, attach one or more document photos, and record a voice note.
5. Save locally once, then submit to peer.
6. Watch `peer-ui` show OCR, transcription, summary, grounded answer, and export generation.
7. Download the markdown export and capture the evidence log for submission.

For automated proof runs, `pnpm validate:live` now generates a synthetic referral-note image and a synthetic voice-note WAV by default so the validation bundle exercises all three capture lanes. The final judge video should still use real phone-captured photo/audio.

Artifacts default to:

- `artifacts/evidence` - job markdown exports plus `events.jsonl`
- `artifacts/validation` - doctor, prewarm, health, validation, and qualification reports
- `data/peer-core` - persisted jobs and uploaded files
- `submission/final-assets` - frozen submission bundle copied from the latest approved run, plus screenshot placeholders and `freeze-manifest.json`

## Validation used here

- `pnpm typecheck`
- `pnpm build`
- `pnpm doctor:live`
- `pnpm prepare:live:dry`
- `pnpm prepare:live`
- `pnpm qualify:live-host:dry`
- `pnpm qualify:live-host`
- `pnpm freeze:submission-assets`
- `pnpm submission:check`
- `powershell -ExecutionPolicy Bypass -File .\scripts\mock-smoke.ps1`
- `powershell -ExecutionPolicy Bypass -File .\scripts\live-validate.ps1`
- `powershell -ExecutionPolicy Bypass -File .\scripts\capture-hardware.ps1`

## Notes

- Pairing is manual URL + code entry today; the peer console already emits a QR payload for a later pass.
- `Build in Public` assets are intentionally out of scope for v1.
- The current approved submission path is honest about its profile: live OCR and transcription on this laptop, deterministic summary assembly for reliability, and a strict non-diagnostic boundary.
- `pnpm freeze:submission-assets` now curates `submission/final-assets/events.jsonl` to the selected approved live job instead of copying older mock runs into the submission bundle.
- `full` mode is still available as an opt-in path for stronger hardware, but it is not required for the current approved submission bundle.
