import fs from "node:fs";
import path from "node:path";

import type { EvidenceEvent } from "@medmesh/shared";

export class EvidenceLog {
  private readonly eventPath: string;

  constructor(private readonly evidenceDir: string) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    this.eventPath = path.join(evidenceDir, "events.jsonl");
  }

  getEventPath(): string {
    return this.eventPath;
  }

  append(
    payload: Omit<EvidenceEvent, "id" | "timestamp"> &
      Partial<Pick<EvidenceEvent, "id" | "timestamp">>,
  ): EvidenceEvent {
    const event: EvidenceEvent = {
      id: payload.id ?? crypto.randomUUID(),
      timestamp: payload.timestamp ?? new Date().toISOString(),
      type: payload.type,
      jobId: payload.jobId,
      casePacketId: payload.casePacketId,
      stage: payload.stage,
      details: payload.details,
    };

    fs.appendFileSync(this.eventPath, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  readAll(): EvidenceEvent[] {
    if (!fs.existsSync(this.eventPath)) {
      return [];
    }

    return fs
      .readFileSync(this.eventPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvidenceEvent);
  }
}
