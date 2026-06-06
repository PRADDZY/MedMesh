import type { AnalysisJob, PairingSession, RuntimeStatus, CasePacket } from "@medmesh/shared";

type UploadValue = {
  uri: string;
  name: string;
  type: string;
};

export interface HealthResponse {
  app: string;
  pairing: PairingSession;
  runtime: RuntimeStatus;
  artifactPaths: RuntimeStatus["artifactPaths"];
}

export async function pingPeer(baseUrl: string): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`Peer check failed with ${response.status}`);
  }

  return (await response.json()) as HealthResponse;
}

export async function submitCasePacket(
  baseUrl: string,
  packet: CasePacket,
): Promise<AnalysisJob> {
  const formData = new FormData();
  formData.append("packet", JSON.stringify(packet));

  for (const attachment of packet.attachments.filter(
    (entry) => entry.kind === "document-photo",
  )) {
    formData.append("documents", {
      uri: attachment.localUri,
      name: attachment.name,
      type: attachment.mimeType ?? "image/jpeg",
    } as unknown as Blob);
  }

  const voiceNote = packet.attachments.find(
    (attachment) => attachment.kind === "voice-note",
  );
  if (voiceNote) {
    formData.append("voiceNote", {
      uri: voiceNote.localUri,
      name: voiceNote.name,
      type: voiceNote.mimeType ?? "audio/m4a",
    } as unknown as Blob);
  }

  const response = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Peer submission failed: ${response.status} ${detail}`);
  }

  return (await response.json()) as AnalysisJob;
}

export async function askGroundedQuestion(
  baseUrl: string,
  jobId: string,
  question: string,
): Promise<AnalysisJob> {
  const response = await fetch(`${baseUrl}/api/jobs/${jobId}/questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Question failed: ${response.status} ${detail}`);
  }

  return (await response.json()) as AnalysisJob;
}
