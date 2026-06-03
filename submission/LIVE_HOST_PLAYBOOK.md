# Live Host Playbook

## Goal

Use the current Windows laptop as the approved live demo host for MedMesh.

## Commands

```powershell
pnpm install
pnpm doctor:live
pnpm qualify:live-host:dry
pnpm qualify:live-host
pnpm freeze:submission-assets
```

## Required approval artifact

Open `artifacts/validation/live-host-qualification.json` and confirm:

- `qualificationStatus` is `approved`
- `recommendedRole` is `approved-live-demo-host`
- `gate.preflightOk` is `true`
- `gate.requestedModeLive` is `true`
- `gate.effectiveModeLive` is `true`
- `gate.validationJobCompleted` is `true`
- `runtime.effectiveMode` is `live`
- `modelSources` show live `whisper` and `ocr` as `loaded`

## Current approved profile

- `MEDMESH_LIVE_PROFILE=lite`
- live `Whisper` transcription
- live `OCR` extraction
- deterministic summary and grounded answer assembly
- provider startup still succeeds and is recorded in the artifacts

## Keep these artifacts

- `artifacts/validation/live-doctor.json`
- `artifacts/validation/live-host-qualification.json`
- `artifacts/validation/live-health.json`
- `artifacts/validation/live-validation.json`
- `artifacts/hardware/hardware-summary.json`
- `artifacts/evidence/events.jsonl`
- `submission/final-assets/freeze-manifest.json`

## Screenshot set

- `mobile-intake.png`
- `peer-console-runtime.png`
- `peer-console-pairing.png`
- `peer-console-summary.png`
- `peer-console-grounded-answer.png`
- `completed-export.png`
- `hardware-model-status.png`

## Notes

- `full` mode is optional and should only be used if stronger hardware is available later.
- After the approved run, use `pnpm freeze:submission-assets` to copy the final generated evidence into `submission/final-assets`.
- Record the demo video only after the approval artifact and screenshot set are complete.
