import {
  heartbeat,
  loadModel,
  ocr,
  profiler,
  transcribe,
} from "@qvac/sdk";

import {
  mergeProcessingPath,
  OFFICIAL_QVAC_MODEL_SOURCES,
  type CaseAttachment,
  type CasePacket,
  type DelegatedPreprocessing,
  type PairingSession,
  type ProcessingPathEntry,
} from "@medmesh/shared";

const HEARTBEAT_TIMEOUT_MS = 8_000;
const DELEGATION_TIMEOUT_MS = 60_000;

interface DelegatedModelCacheEntry {
  ocrModelId?: string;
  whisperModelId?: string;
}

interface ProfilingSnapshot {
  profiling?: Record<string, unknown>;
  profilingSummary?: string;
}

interface DelegatedModelInfo {
  modelId: string;
  modelLoadMs: number;
}

const delegatedModelCache = new Map<string, DelegatedModelCacheEntry>();

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getDocumentAttachments(packet: CasePacket): CaseAttachment[] {
  return packet.attachments.filter(
    (attachment) => attachment.kind === "document-photo",
  );
}

function getVoiceAttachment(packet: CasePacket): CaseAttachment | undefined {
  return packet.attachments.find((attachment) => attachment.kind === "voice-note");
}

function stopProfiler(): ProfilingSnapshot {
  if (!profiler.isEnabled()) {
    return {};
  }

  const exported = profiler.exportJSON();
  const profilingSummary = profiler.exportSummary();
  profiler.disable();
  profiler.clear();

  return {
    profilingSummary,
    profiling: {
      config: exported.config,
      aggregates: exported.aggregates,
      exportedAt: exported.exportedAt,
    },
  };
}

function startProfiler(): void {
  if (profiler.isEnabled()) {
    profiler.disable();
  }

  profiler.clear();
  profiler.enable({
    mode: "verbose",
    includeServerBreakdown: true,
  });
}

async function heartbeatProvider(providerPublicKey: string): Promise<number> {
  const startedAt = Date.now();
  await heartbeat({
    delegate: {
      providerPublicKey,
      timeout: HEARTBEAT_TIMEOUT_MS,
    },
  });
  return Date.now() - startedAt;
}

async function ensureDelegatedOcrModel(
  providerPublicKey: string,
): Promise<DelegatedModelInfo> {
  const cached = delegatedModelCache.get(providerPublicKey);
  if (cached?.ocrModelId) {
    return {
      modelId: cached.ocrModelId,
      modelLoadMs: 0,
    };
  }

  const loadStartedAt = Date.now();
  const modelId = await loadModel({
    modelSrc: OFFICIAL_QVAC_MODEL_SOURCES.ocrLatinRecognizer1,
    modelType: "ocr",
    modelConfig: {
      langList: ["en"],
      pipelineMode: "easyocr",
      contrastRetry: true,
    },
    delegate: {
      providerPublicKey,
      timeout: DELEGATION_TIMEOUT_MS,
      fallbackToLocal: false,
    },
  });

  delegatedModelCache.set(providerPublicKey, {
    ...cached,
    ocrModelId: modelId,
  });

  return {
    modelId,
    modelLoadMs: Date.now() - loadStartedAt,
  };
}

async function ensureDelegatedWhisperModel(
  providerPublicKey: string,
): Promise<DelegatedModelInfo> {
  const cached = delegatedModelCache.get(providerPublicKey);
  if (cached?.whisperModelId) {
    return {
      modelId: cached.whisperModelId,
      modelLoadMs: 0,
    };
  }

  const loadStartedAt = Date.now();
  const modelId = await loadModel({
    modelSrc: OFFICIAL_QVAC_MODEL_SOURCES.whisperTiny,
    modelType: "whisper",
    modelConfig: {
      language: "en",
      strategy: "greedy",
      vadModelSrc: OFFICIAL_QVAC_MODEL_SOURCES.vadSilero512,
    },
    delegate: {
      providerPublicKey,
      timeout: DELEGATION_TIMEOUT_MS,
      fallbackToLocal: false,
    },
  });

  delegatedModelCache.set(providerPublicKey, {
    ...cached,
    whisperModelId: modelId,
  });

  return {
    modelId,
    modelLoadMs: Date.now() - loadStartedAt,
  };
}

function createEntry(
  packet: CasePacket,
  pairing: PairingSession,
  stage: "ocr" | "transcribe",
  patch: Partial<ProcessingPathEntry>,
): ProcessingPathEntry {
  return {
    stage,
    route: patch.route ?? "skipped",
    delegated: patch.delegated ?? false,
    attemptedDelegation: patch.attemptedDelegation ?? false,
    providerPublicKey:
      patch.providerPublicKey ?? pairing.providerPublicKey,
    consumerDeviceLabel:
      patch.consumerDeviceLabel ?? packet.captureDeviceLabel,
    pairingCode: patch.pairingCode ?? packet.pairingCode ?? pairing.code,
    requestedAt: patch.requestedAt ?? new Date().toISOString(),
    completedAt: patch.completedAt,
    durationMs: patch.durationMs,
    heartbeatMs: patch.heartbeatMs,
    modelLoadMs: patch.modelLoadMs,
    operationMs: patch.operationMs,
    note: patch.note,
    delegationError: patch.delegationError,
    profilingSummary: patch.profilingSummary,
    profiling: patch.profiling,
  };
}

async function runDelegatedOcr(
  packet: CasePacket,
  pairing: PairingSession,
): Promise<{ entry: ProcessingPathEntry; ocrText?: string[] }> {
  const documents = getDocumentAttachments(packet);
  if (!documents.length) {
    return {
      entry: createEntry(packet, pairing, "ocr", {
        route: "skipped",
        note: "No document photos attached",
      }),
    };
  }

  const requestedAt = new Date().toISOString();
  let heartbeatMs: number | undefined;
  let modelLoadMs: number | undefined;
  let operationMs: number | undefined;

  try {
    heartbeatMs = await heartbeatProvider(pairing.providerPublicKey);
    startProfiler();
    const delegatedModel = await ensureDelegatedOcrModel(pairing.providerPublicKey);
    modelLoadMs = delegatedModel.modelLoadMs;

    const operationStartedAt = Date.now();
    const ocrText: string[] = [];

    for (const document of documents) {
      const response = ocr({
        modelId: delegatedModel.modelId,
        image: document.localUri,
      }) as {
        blocks: Promise<Array<{ text?: string }>>;
      };

      const blocks = await response.blocks;
      ocrText.push(
        blocks
          .map((block) => block.text)
          .filter(Boolean)
          .join(" "),
      );
    }

    operationMs = Date.now() - operationStartedAt;
    const profiling = stopProfiler();

    return {
      ocrText,
      entry: createEntry(packet, pairing, "ocr", {
        route: "delegated-provider",
        delegated: true,
        attemptedDelegation: true,
        requestedAt,
        completedAt: new Date().toISOString(),
        durationMs:
          (heartbeatMs ?? 0) + (modelLoadMs ?? 0) + (operationMs ?? 0),
        heartbeatMs,
        modelLoadMs,
        operationMs,
        note: `Delegated OCR completed on the paired provider for ${documents.length} document photo(s).`,
        ...profiling,
      }),
    };
  } catch (error) {
    const profiling = stopProfiler();

    return {
      entry: createEntry(packet, pairing, "ocr", {
        route: "skipped",
        delegated: false,
        attemptedDelegation: true,
        requestedAt,
        completedAt: new Date().toISOString(),
        durationMs:
          (heartbeatMs ?? 0) + (modelLoadMs ?? 0) + (operationMs ?? 0),
        heartbeatMs,
        modelLoadMs,
        operationMs,
        note: "Delegated OCR failed on mobile; peer should retry locally.",
        delegationError: normalizeError(error),
        ...profiling,
      }),
    };
  }
}

async function runDelegatedTranscription(
  packet: CasePacket,
  pairing: PairingSession,
): Promise<{ entry: ProcessingPathEntry; transcript?: string }> {
  const voiceAttachment = getVoiceAttachment(packet);
  if (!voiceAttachment) {
    return {
      entry: createEntry(packet, pairing, "transcribe", {
        route: "skipped",
        note: "No voice note attached",
      }),
    };
  }

  const requestedAt = new Date().toISOString();
  let heartbeatMs: number | undefined;
  let modelLoadMs: number | undefined;
  let operationMs: number | undefined;

  try {
    heartbeatMs = await heartbeatProvider(pairing.providerPublicKey);
    startProfiler();
    const delegatedModel = await ensureDelegatedWhisperModel(
      pairing.providerPublicKey,
    );
    modelLoadMs = delegatedModel.modelLoadMs;

    const operationStartedAt = Date.now();
    const transcript = await transcribe({
      modelId: delegatedModel.modelId,
      audioChunk: voiceAttachment.localUri,
    });
    operationMs = Date.now() - operationStartedAt;
    const profiling = stopProfiler();

    return {
      transcript,
      entry: createEntry(packet, pairing, "transcribe", {
        route: "delegated-provider",
        delegated: true,
        attemptedDelegation: true,
        requestedAt,
        completedAt: new Date().toISOString(),
        durationMs:
          (heartbeatMs ?? 0) + (modelLoadMs ?? 0) + (operationMs ?? 0),
        heartbeatMs,
        modelLoadMs,
        operationMs,
        note: "Delegated speech transcription completed on the paired provider.",
        ...profiling,
      }),
    };
  } catch (error) {
    const profiling = stopProfiler();

    return {
      entry: createEntry(packet, pairing, "transcribe", {
        route: "skipped",
        delegated: false,
        attemptedDelegation: true,
        requestedAt,
        completedAt: new Date().toISOString(),
        durationMs:
          (heartbeatMs ?? 0) + (modelLoadMs ?? 0) + (operationMs ?? 0),
        heartbeatMs,
        modelLoadMs,
        operationMs,
        note: "Delegated transcription failed on mobile; peer should retry locally.",
        delegationError: normalizeError(error),
        ...profiling,
      }),
    };
  }
}

export async function runDelegatedPreprocessing(
  packet: CasePacket,
  pairing: PairingSession,
): Promise<DelegatedPreprocessing> {
  let processingPath: ProcessingPathEntry[] = [];
  const delegatedPreprocessing: DelegatedPreprocessing = {
    processingPath,
  };

  const delegatedOcr = await runDelegatedOcr(packet, pairing);
  processingPath = mergeProcessingPath(processingPath, delegatedOcr.entry);
  delegatedPreprocessing.processingPath = processingPath;
  if (delegatedOcr.ocrText) {
    delegatedPreprocessing.ocrText = delegatedOcr.ocrText;
  }

  const delegatedTranscription = await runDelegatedTranscription(packet, pairing);
  processingPath = mergeProcessingPath(processingPath, delegatedTranscription.entry);
  delegatedPreprocessing.processingPath = processingPath;
  if (delegatedTranscription.transcript !== undefined) {
    delegatedPreprocessing.transcript = delegatedTranscription.transcript;
  }

  return delegatedPreprocessing;
}
