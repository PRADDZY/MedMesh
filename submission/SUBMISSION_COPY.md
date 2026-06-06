# Submission Copy

## Title

MedMesh Handoff

## One-line pitch

A private mobile-to-laptop handoff workflow that captures structured intake, document photos, and voice notes offline, then delegates QVAC OCR and transcription to a nearby peer to assemble a grounded, non-diagnostic handoff packet.

## Problem

Emergency and referral handoffs often happen under pressure, with poor connectivity, fragmented notes, and privacy-sensitive patient context. Important details can be lost between the field and the receiving clinician.

## Solution

MedMesh lets a responder or clinician capture a case on an Android phone using three lanes: structured intake, document photos, and a voice note. The phone then delegates OCR and speech transcription to a trusted nearby Windows laptop over QVAC, and the peer produces a concise grounded handoff summary plus follow-up support for the receiving clinician.

## How this uses QVAC

MedMesh uses `@qvac/sdk` for provider startup, delegated OCR, delegated speech transcription, and local model orchestration. The approved current-laptop submission path runs the `lite` live profile: the Android app is a true QVAC consumer for OCR and transcription, while summary assembly and grounded answer generation stay deterministic and local on the peer for reliability on 4 GB Windows hardware.

## Privacy / local-first note

No cloud AI APIs are required. The phone stores case packets locally, the peer stores jobs and evidence locally, and the approved runtime path keeps AI processing on the nearby laptop.

## Track fit

Current approved submission path: `General Purpose`.

If stronger hardware becomes available later, `MEDMESH_LIVE_PROFILE=full` can be used to test a fuller MedPsy path, but that is not part of the current approved submission bundle.

## Repo link

`https://github.com/PRADDZY/MedMesh`

## Demo link

Add the final video URL after recording.
