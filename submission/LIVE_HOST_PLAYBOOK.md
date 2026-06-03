# Live Host Playbook

## Goal

Approve one stronger nearby machine as the `live demo host` for MedMesh while keeping the current Windows laptop available as a dev or control node.

## Commands

On the candidate live host:

```powershell
pnpm install
pnpm qualify:live-host:dry
pnpm qualify:live-host
```

## Required approval artifact

Open `artifacts/validation/live-host-qualification.json` and confirm:

- `qualificationStatus` is `approved`
- `recommendedRole` is `approved-live-demo-host`
- `gate.preflightOk` is `true`
- `gate.requestedModeLive` is `true`
- `gate.effectiveModeLive` is `true`
- `gate.validationJobCompleted` is `true`

If any of those are not true, do not use that machine as the final live peer.

## Keep these artifacts

- `artifacts/validation/live-host-qualification.json`
- `artifacts/validation/live-health.json`
- `artifacts/validation/live-validation.json`
- `artifacts/hardware/hardware-summary.json`
- `artifacts/evidence/events.jsonl`

## Screenshot set

- `peer-console-runtime.png`
- `peer-console-pairing.png`
- `peer-console-summary.png`
- `peer-console-grounded-answer.png`
- `mobile-intake.png`
- `completed-export.png`

## Notes

- The current Windows dev laptop may still be useful for control, editing, or screen management even if it is not the approved live host.
- If the candidate host only reaches `candidate-live-host`, keep tuning `MEDMESH_CTX_SIZE` and `MEDMESH_GPU_LAYERS` before recording the final run.
- Record the demo video only after the approval artifact and screenshot set are complete.
