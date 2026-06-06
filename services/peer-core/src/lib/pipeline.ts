import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  NON_DIAGNOSTIC_DISCLAIMER,
  mergeProcessingPath,
  type AnalysisJob,
  type AnalysisStage,
  type AnalysisStageName,
  type CasePacket,
  type GroundedAnswer,
  type ProcessingPathEntry,
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

interface StageRunResult<T> {
  job: AnalysisJob;
  value: T;
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

function getStageRecord(
  job: AnalysisJob,
  stageName: AnalysisStageName,
): AnalysisStage | undefined {
  return job.stages.find((stage) => stage.name === stageName);
}

function formatTiming(value?: number): string {
  return typeof value === "number" ? `${value}ms` : "n/a";
}

function formatProcessingEntry(entry: ProcessingPathEntry): string {
  const route =
    entry.route === "delegated-provider"
      ? `delegated via ${entry.providerPublicKey?.slice(0, 12) ?? "paired provider"}`
      : entry.route === "peer-local"
        ? entry.attemptedDelegation
          ? "peer-local fallback after delegation attempt"
          : "peer-local"
        : "skipped";
  const timings = [
    entry.durationMs ? `total ${formatTiming(entry.durationMs)}` : undefined,
    entry.heartbeatMs ? `heartbeat ${formatTiming(entry.heartbeatMs)}` : undefined,
    entry.modelLoadMs ? `load ${formatTiming(entry.modelLoadMs)}` : undefined,
    entry.operationMs ? `compute ${formatTiming(entry.operationMs)}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  const note = entry.note ? ` - ${entry.note}` : "";
  const error = entry.delegationError ? ` - error: ${entry.delegationError}` : "";

  return `- ${entry.stage}: ${route}${timings ? ` (${timings})` : ""}${note}${error}`;
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
  const inputSummary = job.inputSummary;
  const transcriptExcerpt = job.transcript
    ? job.transcript.slice(0, 240)
    : "No voice transcript available.";
  const processingPath = job.processingPath.length
    ? job.processingPath.map(formatProcessingEntry).join("\n")
    : "- No delegated preprocessing trace recorded.";

  return `# MedMesh Handoff Export\n\n## Job\n- Job ID: ${job.id}\n- Case Packet: ${job.casePacketId}\n- Status: ${job.status}\n- Pairing Code: ${job.pairingCode}\n- Requested Mode: ${job.runtime.requestedMode}\n- Effective Mode: ${job.runtime.effectiveMode}\n- Peer Device: ${job.runtime.hardware.deviceLabel}\n- CPU: ${job.runtime.hardware.cpuModel} (${job.runtime.hardware.cpuCores} cores)\n- Memory: ${job.runtime.hardware.totalMemoryGb} GB\n\n## Source Evidence\n- Document photos: ${inputSummary?.documentCount ?? 0}\n- Voice note attached: ${inputSummary?.hasVoiceNote ? "Yes" : "No"}\n- Attachment files: ${(inputSummary?.attachmentNames ?? []).join(", ") || "None"}\n- OCR text items: ${job.ocrText.length}\n- Transcript excerpt: ${transcriptExcerpt}\n\n## Processing Path\n${processingPath}\n\n## Summary\n- Overview: ${summary?.overview ?? "Pending"}\n- Situation: ${summary?.presentingSituation ?? "Pending"}\n- Key Findings: ${(summary?.keyFindings ?? []).join("; ")}\n- Unresolved Risks: ${(summary?.unresolvedRisks ?? []).join("; ")}\n\n## Protocol-grounded Q&A\n${answers || "- None yet"}\n\n## Stage timings\n${stages}\n\n## Disclaimer\n${NON_DIAGNOSTIC_DISCLAIMER}\n`;
}

function createProcessingEntry(
  job: AnalysisJob,
  packet: CasePacket,
  stageName: "ocr" | "transcribe",
  baseEntry: ProcessingPathEntry | undefined,
  overrides: Partial<ProcessingPathEntry>,
): ProcessingPathEntry {
  const stageRecord = getStageRecord(job, stageName);

  return {
    stage: stageName,
    route: overrides.route ?? baseEntry?.route ?? "peer-local",
    delegated: overrides.delegated ?? baseEntry?.delegated ?? false,
    attemptedDelegation:
      overrides.attemptedDelegation ?? baseEntry?.attemptedDelegation ?? false,
    providerPublicKey:
      overrides.providerPublicKey ??
      packet.providerPublicKey ??
      baseEntry?.providerPublicKey,
    consumerDeviceLabel:
      overrides.consumerDeviceLabel ??
      packet.captureDeviceLabel ??
      baseEntry?.consumerDeviceLabel,
    pairingCode:
      overrides.pairingCode ?? packet.pairingCode ?? job.pairingCode ?? baseEntry?.pairingCode,
    requestedAt:
      overrides.requestedAt ??
      baseEntry?.requestedAt ??
      stageRecord?.startedAt ??
      new Date().toISOString(),
    completedAt:
      overrides.completedAt ?? baseEntry?.completedAt ?? stageRecord?.completedAt,
    durationMs:
      overrides.durationMs ?? baseEntry?.durationMs ?? stageRecord?.durationMs,
    heartbeatMs: overrides.heartbeatMs ?? baseEntry?.heartbeatMs,
    modelLoadMs: overrides.modelLoadMs ?? baseEntry?.modelLoadMs,
    operationMs: overrides.operationMs ?? baseEntry?.operationMs,
    note: overrides.note ?? baseEntry?.note,
    delegationError: overrides.delegationError ?? baseEntry?.delegationError,
    profilingSummary: overrides.profilingSummary ?? baseEntry?.profilingSummary,
    profiling: overrides.profiling ?? baseEntry?.profiling,
  };
}

export async function runAnalysisJob(
  context: PipelineContext,
  job: AnalysisJob,
  packet: CasePacket,
  files: UploadedFiles,
): Promise<void> {
  const delegatedOcrEntry = packet.delegatedPreprocessing?.processingPath.find(
    (entry) => entry.stage === "ocr",
  );
  const delegatedTranscribeEntry =
    packet.delegatedPreprocessing?.processingPath.find(
      (entry) => entry.stage === "transcribe",
    );
  const hasDelegatedOcr = Array.isArray(packet.delegatedPreprocessing?.ocrText);
  const hasDelegatedTranscript =
    packet.delegatedPreprocessing?.transcript !== undefined;

  try {
    job = persistJob(context.store, {
      ...job,
      status: "running",
      updatedAt: new Date().toISOString(),
    });

    const ocrStage = await runStage(
      context,
      job,
      "ocr",
      async () => {
        if (hasDelegatedOcr) {
          const note =
            delegatedOcrEntry?.note ??
            `Used delegated OCR from ${packet.providerPublicKey?.slice(0, 12) ?? "paired provider"}.`;
          return {
            value: packet.delegatedPreprocessing?.ocrText ?? [],
            details: {
              route: "delegated-provider",
              delegated: true,
              attemptedDelegation: true,
              providerPublicKey:
                packet.providerPublicKey ?? delegatedOcrEntry?.providerPublicKey,
            },
            note,
          };
        }

        if (!files.documentPaths.length) {
          return {
            value: [],
            details: {
              route: "skipped",
              delegated: false,
              attemptedDelegation:
                delegatedOcrEntry?.attemptedDelegation ?? false,
              imageCount: 0,
            },
            note: "No document photos attached",
          };
        }

        const result = await context.runtime.extractOcrData(files.documentPaths);
        return {
          value: result.texts,
          details: {
            ...result.details,
            route: "peer-local",
            delegated: false,
            attemptedDelegation:
              delegatedOcrEntry?.attemptedDelegation ?? false,
            providerPublicKey:
              packet.providerPublicKey ?? delegatedOcrEntry?.providerPublicKey,
          },
          note: delegatedOcrEntry?.attemptedDelegation
            ? "Mobile delegation was unavailable; peer completed OCR locally."
            : "Peer completed OCR locally.",
        };
      },
      hasDelegatedOcr
        ? "Delegated OCR completed on the paired QVAC provider"
        : files.documentPaths.length > 0
          ? `Prepared ${files.documentPaths.length} document photo(s)`
          : "No document photos attached",
    );

    const ocrProcessingEntry = createProcessingEntry(
      ocrStage.job,
      packet,
      "ocr",
      delegatedOcrEntry,
      hasDelegatedOcr
        ? {
            route: "delegated-provider",
            delegated: true,
            attemptedDelegation: true,
            note:
              delegatedOcrEntry?.note ??
              `Delegated OCR completed on the paired provider for ${packet.delegatedPreprocessing?.ocrText?.length ?? 0} document result(s).`,
          }
        : {
            route: files.documentPaths.length > 0 ? "peer-local" : "skipped",
            delegated: false,
            attemptedDelegation:
              delegatedOcrEntry?.attemptedDelegation ?? false,
            note:
              files.documentPaths.length > 0
                ? delegatedOcrEntry?.attemptedDelegation
                  ? "Delegation was attempted on mobile; peer completed OCR locally."
                  : "Peer completed OCR locally."
                : "No document photos attached",
          },
    );

    job = persistJob(context.store, {
      ...ocrStage.job,
      ocrText: ocrStage.value,
      processingPath: mergeProcessingPath(
        ocrStage.job.processingPath,
        ocrProcessingEntry,
      ),
      updatedAt: new Date().toISOString(),
    });

    const transcribeStage = await runStage(
      context,
      job,
      "transcribe",
      async () => {
        if (hasDelegatedTranscript) {
          const note =
            delegatedTranscribeEntry?.note ??
            `Used delegated transcription from ${packet.providerPublicKey?.slice(0, 12) ?? "paired provider"}.`;
          return {
            value: packet.delegatedPreprocessing?.transcript ?? "",
            details: {
              route: "delegated-provider",
              delegated: true,
              attemptedDelegation: true,
              providerPublicKey:
                packet.providerPublicKey ??
                delegatedTranscribeEntry?.providerPublicKey,
            },
            note,
          };
        }

        const result = await context.runtime.transcribeAudioData(
          files.voiceNotePath,
        );
        return {
          value: result.text,
          details: {
            ...result.details,
            route: files.voiceNotePath ? "peer-local" : "skipped",
            delegated: false,
            attemptedDelegation:
              delegatedTranscribeEntry?.attemptedDelegation ?? false,
            providerPublicKey:
              packet.providerPublicKey ??
              delegatedTranscribeEntry?.providerPublicKey,
          },
          note: files.voiceNotePath
            ? delegatedTranscribeEntry?.attemptedDelegation
              ? "Delegation was attempted on mobile; peer transcribed the voice note locally."
              : "Peer transcribed the voice note locally."
            : "No voice note attached",
        };
      },
      hasDelegatedTranscript
        ? "Delegated speech transcription completed on the paired QVAC provider"
        : files.voiceNotePath
          ? "Prepared voice note evidence"
          : "No voice note attached",
    );

    const transcribeProcessingEntry = createProcessingEntry(
      transcribeStage.job,
      packet,
      "transcribe",
      delegatedTranscribeEntry,
      hasDelegatedTranscript
        ? {
            route: "delegated-provider",
            delegated: true,
            attemptedDelegation: true,
            note:
              delegatedTranscribeEntry?.note ??
              "Delegated speech transcription completed on the paired provider.",
          }
        : {
            route: files.voiceNotePath ? "peer-local" : "skipped",
            delegated: false,
            attemptedDelegation:
              delegatedTranscribeEntry?.attemptedDelegation ?? false,
            note: files.voiceNotePath
              ? delegatedTranscribeEntry?.attemptedDelegation
                ? "Delegation was attempted on mobile; peer transcribed the voice note locally."
                : "Peer transcribed the voice note locally."
              : "No voice note attached",
          },
    );

    job = persistJob(context.store, {
      ...transcribeStage.job,
      transcript: transcribeStage.value,
      processingPath: mergeProcessingPath(
        transcribeStage.job.processingPath,
        transcribeProcessingEntry,
      ),
      updatedAt: new Date().toISOString(),
    });

    const citationsStage = await runStage(
      context,
      job,
      "normalize",
      async () => ({
        value: searchProtocolDocuments(
          buildProtocolQuery(packet.structuredIntake, job.transcript ?? "", job.ocrText),
          3,
        ),
        details: {
          mode: context.runtime.getStatus().effectiveMode,
          delegatedStages: job.processingPath.map((entry) => ({
            stage: entry.stage,
            route: entry.route,
          })),
        },
      }),
      "Prepared protocol search context",
    );
    job = persistJob(context.store, {
      ...citationsStage.job,
      processingPath: [...job.processingPath],
      updatedAt: new Date().toISOString(),
    });

    const summaryStage = await runStage(
      context,
      job,
      "summarize",
      async () => {
        const result = await context.runtime.summarizeCase({
          packet,
          ocrText: job.ocrText,
          transcript: job.transcript ?? "",
          citations: citationsStage.value,
        });
        return {
          value: result.summary,
          details: result.details,
        };
      },
      "Built structured handoff summary",
    );
    job = persistJob(context.store, {
      ...summaryStage.job,
      summary: summaryStage.value,
      updatedAt: new Date().toISOString(),
    });

    const defaultQuestion = "What should the receiving clinician verify first?";
    const groundedStage = await runStage(
      context,
      job,
      "ground",
      async () => {
        const result = await context.runtime.answerQuestion(
          defaultQuestion,
          summaryStage.value,
          citationsStage.value,
        );
        return {
          value: result.answer,
          details: result.details,
        };
      },
      "Generated first grounded follow-up answer",
    );

    const groundedAnswers: GroundedAnswer[] = [groundedStage.value];
    const completedJob: AnalysisJob = {
      ...groundedStage.job,
      status: "completed",
      updatedAt: new Date().toISOString(),
      processingPath: [...job.processingPath],
      summary: summaryStage.value,
      groundedAnswers,
    };
    const exportContent = createExportMarkdown(completedJob);
    const exportPath = path.join(context.evidenceDir, `${job.id}.md`);
    fs.writeFileSync(exportPath, exportContent, "utf8");

    context.evidence.append({
      type: "job.completed",
      jobId: job.id,
      casePacketId: packet.id,
      details: {
        exportPath,
        qnaCount: groundedAnswers.length,
        effectiveMode: completedJob.runtime.effectiveMode,
        processingPath: completedJob.processingPath.map((entry) => ({
          stage: entry.stage,
          route: entry.route,
          delegated: entry.delegated,
          attemptedDelegation: entry.attemptedDelegation,
          providerPublicKey: entry.providerPublicKey,
        })),
      },
    });

    persistJob(context.store, {
      ...completedJob,
      exportPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    context.evidence.append({
      type: "job.failed",
      jobId: job.id,
      casePacketId: packet.id,
      details: {
        message,
        processingPath: job.processingPath.map((entry) => ({
          stage: entry.stage,
          route: entry.route,
          attemptedDelegation: entry.attemptedDelegation,
          delegated: entry.delegated,
        })),
      },
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
): Promise<StageRunResult<T>> {
  const startedAt = new Date().toISOString();
  let stageJob = updateStage(job, stageName, "running", note, startedAt);
  persistJob(context.store, stageJob);
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
    stageJob = updateStage(
      stageJob,
      stageName,
      "completed",
      stageNote,
      startedAt,
      durationMs,
    );
    persistJob(context.store, stageJob);
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
    return {
      job: stageJob,
      value: result.value,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - timer);
    const message = error instanceof Error ? error.message : "Unknown error";
    stageJob = updateStage(
      stageJob,
      stageName,
      "failed",
      message,
      startedAt,
      durationMs,
    );
    persistJob(context.store, stageJob);
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
