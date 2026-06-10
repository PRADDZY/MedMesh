# Final Submission Runbook

This is the last operator pass for MedMesh. Do not change product scope from here.

## Locked truth

- Final track: `General Purpose`
- Final runtime story: `lite` live profile on the current Windows laptop
- Real QVAC path: live delegated `OCR` + live delegated `Whisper`
- Deterministic local path: summary assembly + grounded answer
- Final proof bundle already passes every automated gate except the manual assets

## Current status

As of `June 10, 2026`, the only remaining submission blockers are:

- the `7` required screenshots
- the final public demo video URL in `submission/SUBMISSION_COPY.md`

Everything else is already green in the frozen bundle:

- `qualificationStatus=approved`
- `effectiveMode=live`
- `documentCount=1`
- `hasVoiceNote=true`

## Use these commands on Windows

Use `pnpm.cmd` in PowerShell to avoid execution-policy issues with `pnpm.ps1`.

```powershell
pnpm.cmd final:submission
pnpm.cmd submission:check
```

## Final sequence

### 1) Confirm the frozen state

Run:

```powershell
pnpm.cmd final:submission
```

Read:

- `artifacts/validation/final-submission-pass.json`

Expected result right now:

- only screenshot and video blockers remain

### 2) Capture the final screenshots

Save these exact files in `submission/final-assets/screenshots`:

- `mobile-intake.png`
- `peer-console-runtime.png`
- `peer-console-pairing.png`
- `peer-console-summary.png`
- `peer-console-grounded-answer.png`
- `completed-export.png`
- `hardware-model-status.png`

Suggested order:

1. Start `peer-core` and `peer-ui`
2. Open the phone and capture `mobile-intake.png`
3. Capture pairing/runtime in `peer-ui`
4. Run the final live case
5. Capture summary and grounded answer in `peer-ui`
6. Open the markdown export and capture `completed-export.png`
7. Capture the hardware/model status view last

### 3) Record the demo video

Use `submission/DEMO_SCRIPT.md`.

Hard requirements for the final recording:

- use the Android phone, not a simulator
- show all three lanes: structured intake, document photo, voice note
- show the nearby laptop peer and QVAC runtime
- show the completed summary and grounded answer
- show the export

### 4) Paste the final video URL

Edit:

- `submission/SUBMISSION_COPY.md`

Replace:

- `Add the final video URL after recording.`

With:

- the public final video URL

### 5) Run the final green gate

Run:

```powershell
pnpm.cmd submission:check
```

Expected result:

- `status: ready`

### 6) Submit from the repo copy

Use:

- `submission/SUBMISSION_COPY.md` for form text
- `submission/REMOTE_SERVICES.md` for disclosure truth
- `submission/final-assets/` for evidence and screenshots

## Do not change

- do not switch tracks at the last minute
- do not claim `full` mode
- do not claim MedPsy live reasoning on this laptop
- do not regenerate evidence unless the final live run actually changed
- do not submit from a branch other than `main`

## Final pre-submit checklist

- [ ] `pnpm.cmd final:submission` reviewed
- [ ] all `7` screenshots saved with exact filenames
- [ ] final public video uploaded
- [ ] final video URL pasted into `submission/SUBMISSION_COPY.md`
- [ ] `pnpm.cmd submission:check` returns ready
- [ ] `git status --short` is clean
- [ ] GitHub default branch is `main`
- [ ] DoraHacks form pasted from `submission/SUBMISSION_COPY.md`
