# Remote Services Disclosure

## AI services

- None required.

## Optional non-AI services

- None required for the base demo.

## Local-only behavior

- The phone stores case packets locally with SQLite and app document storage.
- The peer service stores jobs, validation artifacts, and evidence on local disk.
- The approved current-laptop path runs `@qvac/sdk` live `Whisper` transcription and live `OCR` locally.
- Summary assembly and grounded answer generation are deterministic local logic in the approved `lite` profile.
- `full` mode remains an optional stronger-hardware path and is not required for the current submission bundle.
