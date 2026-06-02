# Remote Services Disclosure

## AI services

- None required.

## Optional non-AI services

- None required for the base demo.

## Local-only behavior

- The phone stores case packets locally with SQLite and app document storage.
- The peer service stores jobs and evidence on local disk.
- All current AI paths run in `mock` mode by default or `@qvac/sdk` live mode when local model files are supplied.
