import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  NON_DIAGNOSTIC_DISCLAIMER,
  type AnalysisJob,
  type AnalysisStageName,
  type CasePacket,
  type GroundedAnswer,
} from "@medmesh/shared";

import type { EvidenceLog } from "./evidence-log.js";
import type { JobStore } from "./job-store.js";
import { buildProtocolQuery, searchProtocolDocuments } from "./protocol-search.js";
import type { QvacRuntime } from "./qvac-runtime.js";

export interface UploadedFiles {
  documentPaths: string[];
  voiceNotePath?: string;
}

interface PipelineContext {
  store: JobStore;
  evidence: EvidenceLog;
  runtime: QvacRuntime;
  evidenceDir: string;
}

interface StageOutcome<T> {
  value: T;
  details?: Record<string, unknown>;
  note?: string;
}

function updateStage(
  job: AnalysisJob,
  stageName: AnalysisStageName,
  state: AnalysisJob["stages"][number]["state"],
  note?: string,
  startedAt?: string,
  durationMs?: number,
): AnalysisJob {
  const stages = job.stages.map((stage) =>
    stage.name === stageName
      ? {
          ...stage,
          state,
          note,
          startedAt: startedAt ?? stage.startedAt,
          completedAt:
            state === "completed" || state === "failed"
              ? new Date().toISOString()
              : stage.completedAt,
          durationMs: durationMs ?? stage.durationMs,
        }
      : stage,
  );

  return {
    ...job,
    stages,
    updatedAt: new Date().toISOString(),
  };
}

function persistJob(store: JobStore, job: AnalysisJob): AnalysisJob {
  store.upsert(job);
  return job;
}

function createExportMarkdown(job: AnalysisJob): string {
  const summary = job.summary;
  const answers = job.groundedAnswers
    .map((answer) => `- Q: ${answer.question}\n  A: ${answer.answer}`)
    .join("\n");
  const stages = job.stages
    .map(
      (stage) =>
        `- ${stage.name}: ${stage.state}${stage.durationMs ? ` (${stage.durationMs}ms)` : ""}`,
    )
    .join("\n");

  return `# MedMesh Handoff Export\n\n## Job\n- Job ID: ${job.id}\n- Case Packet: ${job.casePacketId}\n- Status: ${job.status}\n- Pairing Code: ${job.pairingCode}\n- Requested Mode: ${job.runtime.requestedMode}\n- Effective Mode: ${job.runtime.effectiveMode}\n- Peer Device: ${job.runtime.hardware.deviceLabel}\n- CPU: ${job.runtime.hardware.cpuModel} (${job.runtime.hardware.cpuCores} cores)\n- Memory: ${job.runtime.hardware.totalMemoryGb} GB\n\n## Summary\n- Overview: ${summary?.overview ?? "Pending"}\n- Situation: ${summary?.presentingSituation ?? "Pending"}\n- Key Findings: ${(summary?.keyFindings ?? []).join("; ")}\n- Unresolved Risks: ${(summary?.unresolvedRisks ?? []).join("; ")}\n\n## Protocol-grounded Q&A\n${answers || "- None yet"}\n\n## Stage timings\n${stages}\n\n## Disclaimer\n${NON_DIAGNOSTIC_DISCLAIMER}\n`;
}

export async function runAnalysisJob(
  context: PipelineContext,
  job: AnalysisJob,
  packet: CasePacket,
  files: UploadedFiles,
): Promise<void> {
  try {
    job = persistJob(context.store, {
      ...job,
      status: "running",
      updatedAt: new Date().toISOString(),
    });

    const ocrText = await runStage(
      context,
      job,
      "ocr",
      async () => {
        const result = await context.runtime.extractOcrData(files.documentPaths);
        return {
          value: result.texts,
          details: result.details,
        };
      },
      files.documentPaths.length > 0
        ? `Processed ${files.documentPaths.length} documents`
        : "No document photos attached",
    );
    job = persistJob(context.store, {
      ...job,
      ocrText,
      updatedAt: new Date().toISOString(),
    });

    const transcript = await runStage(
      context,
      job,
      "transcribe",
      async () => {
        const result = await context.runtime.transcribeAudioData(
          files.voiceNotePath,
        );
        return {
          value: result.text,
          details: result.details,
        };
      },
      files.voiceNotePath ? "Voice note captured" : "No voice note attached",
    );
    job = persistJob(context.store, {
      ...job,
      transcript,
      updatedAt: new Date().toISOString(),
    });

    const citations = await runStage(
      context,
      job,
      "normalize",
      async () => ({
        value: searchProtocolDocuments(
          buildProtocolQuery(packet.structuredIntake, transcript, ocrText),
          3,
        ),
        details: {
          mode: context.runtime.getStatus().effectiveMode,
        },
      }),
      "Prepared protocol search context",
    );

    const summary = await runStage(
      context,
      job,
      "summarize",
      async () => {
        const result = await context.runtime.summarizeCase({
          packet,
          ocrText,
          transcript,
          citations,
        });
        return {
          value: result.summary,
          details: result.details,
        };
      },
      "Built structured handoff summary",
    );
    job = persistJob(context.store, {
      ...job,
      summary,
      updatedAt: new Date().toISOString(),
    });

    const defaultQuestion = "What should the receiving clinician verify first?";
    const groundedAnswer = await runStage(
      context,
      job,
      "ground",
      async () => {
        const result = await context.runtime.answerQuestion(
          defaultQuestion,
          summary,
          citations,
        );
        return {
          value: result.answer,
          details: result.details,
        };
      },
      "Generated first grounded follow-up answer",
    );

    const groundedAnswers: GroundedAnswer[] = [groundedAnswer];
    const exportContent = createExportMarkdown({
      ...job,
      summary,
      groundedAnswers,
    });
    const exportPath = path.join(context.evidenceDir, `${job.id}.md`);
    fs.writeFileSync(exportPath, exportContent, "utf8");

    context.evidence.append({
      type: "job.completed",
      jobId: job.id,
      casePacketId: packet.id,
      details: {
        exportPath,
        qnaCount: groundedAnswers.length,
        effectiveMode: job.runtime.effectiveMode,
      },
    });

    persistJob(context.store, {
      ...job,
      status: "completed",
      updatedAt: new Date().toISOString(),
      summary,
      groundedAnswers,
      exportPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    context.evidence.append({
      type: "job.failed",
      jobId: job.id,
      casePacketId: packet.id,
      details: { message },
    });

    persistJob(context.store, {
      ...job,
      status: "failed",
      updatedAt: new Date().toISOString(),
      errorMessage: message,
    });
  }
}

async function runStage<T>(
  context: PipelineContext,
  job: AnalysisJob,
  stageName: AnalysisStageName,
  action: () => Promise<StageOutcome<T>>,
  note: string,
): Promise<T> {
  const startedAt = new Date().toISOString();
  let startedJob = updateStage(job, stageName, "running", note, startedAt);
  persistJob(context.store, startedJob);
  context.evidence.append({
    type: "stage.started",
    jobId: job.id,
    casePacketId: job.casePacketId,
    stage: stageName,
    details: { note },
  });

  const timer = performance.now();
  try {
    const result = await action();
    const durationMs = Math.round(performance.now() - timer);
    const stageNote = result.note ?? note;
    startedJob = updateStage(
      startedJob,
      stageName,
      "completed",
      stageNote,
      startedAt,
      durationMs,
    );
    persistJob(context.store, startedJob);
    context.evidence.append({
      type: "stage.completed",
      jobId: job.id,
      casePacketId: job.casePacketId,
      stage: stageName,
      details: {
        note: stageNote,
        durationMs,
        ...(result.details ?? {}),
      },
    });
    return result.value;
  } catch (error) {
    const durationMs = Math.round(performance.now() - timer);
    const message = error instanceof Error ? error.message : "Unknown error";
    startedJob = updateStage(
      startedJob,
      stageName,
      "failed",
      message,
      startedAt,
      durationMs,
    );
    persistJob(context.store, startedJob);
    context.evidence.append({
      type: "stage.failed",
      jobId: job.id,
      casePacketId: job.casePacketId,
      stage: stageName,
      details: {
        note: message,
        durationMs,
      },
    });
    throw error;
  }
}
