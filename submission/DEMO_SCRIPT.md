# Demo Script

## Arc

1. Open `apps/peer-ui` and show the pairing code, runtime mode, live profile, and local-only disclosure.
2. Open the Expo app on Android and explain the three capture lanes: structured intake, document photos, and voice note.
3. Fill a short emergency handoff case with one red flag, one intervention, and a behavioral-health note.
4. Attach at least one document photo and record a short voice note.
5. Save locally to prove offline-first capture, then submit to the nearby peer and call out that the phone is delegating OCR and transcription first.
6. Switch back to `peer-ui` and narrate the stages: delegated OCR, delegated transcription, summary, grounded answer.
7. Open the markdown export and point to the evidence trail plus non-diagnostic disclaimer.

## Suggested spoken framing

- "MedMesh keeps the capture workflow private on the phone and delegates OCR plus transcription to this trusted nearby laptop."
- "On this laptop, the approved live profile exposes a real QVAC provider, so the phone is a true consumer instead of just an HTTP client."
- "This final run shows all three intake lanes: structured form, document photo, and voice note."
- "The goal is safer handoff and continuity of care, not diagnosis."

## Judge proof points

- Local-first capture still works before submission to peer.
- QVAC runtime and provider identity are visible in the peer console.
- OCR and transcription are shown as `delegated-provider` stages on the selected job.
- OCR and transcription models are loaded live on the approved laptop.
- The selected job shows attached inputs, delegated trace metadata, and the export records source evidence.
- Evidence log and markdown export are generated automatically.
- Protocol grounding is shown through the first follow-up answer.
