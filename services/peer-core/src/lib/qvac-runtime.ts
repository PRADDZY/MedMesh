import os from "node:os";
import path from "node:path";

import {
  NON_DIAGNOSTIC_DISCLAIMER,
  type CasePacket,
  type GroundedAnswer,
  type HardwareSummary,
  type HandoffSummary,
  type ModelStatus,
  type ProtocolCitation,
  type RuntimeStatus,
} from "@medmesh/shared";

import type { MedMeshConfig } from "../config.js";

type QvacSdkModule = typeof import("@qvac/sdk");
type ModelType = ModelStatus["modelType"];

interface SummaryInput {
  packet: CasePacket;
  ocrText: string[];
  transcript: string;
  citations: ProtocolCitation[];
}

interface OcrExtractionResult {
  texts: string[];
  details: Record<string, unknown>;
}

interface TranscriptResult {
  text: string;
  details: Record<string, unknown>;
}

interface SummaryResult {
  summary: HandoffSummary;
  details: Record<string, unknown>;
}

interface AnswerResult {
  answer: GroundedAnswer;
  details: Record<string, unknown>;
}

interface ModelLoadConfig {
  modelType: ModelType;
  label: string;
  modelSrc?: string;
  modelConfig?: Record<string, unknown>;
}

export class QvacRuntime {
  private sdk?: QvacSdkModule;
  private runtimeStatus: RuntimeStatus;
  private llmModelId?: string;
  private whisperModelId?: string;
  private ocrModelId?: string;
  private embeddingsModelId?: string;

  constructor(private readonly config: MedMeshConfig) {
    const requestedMode = config.qvacMode;
    const hardware = this.buildHardwareSummary();

    this.runtimeStatus = {
      requestedMode,
      effectiveMode: "mock",
      mode: "mock",
      health: requestedMode === "mock" ? "ready" : "degraded",
      providerStarted: false,
      providerTopic: config.providerTopic,
      providerPublicKey: "",
      hardware,
      artifactPaths: {
        dataDir: config.dataDir,
        evidenceDir: config.evidenceDir,
      },
      models: [
        this.createModelStatus("llm", "MedPsy Reasoner", config.llmModelSrc, true),
        this.createModelStatus(
          "whisper",
          "Whisper Transcriber",
          config.whisperModelSrc,
          true,
        ),
        this.createModelStatus("ocr", "OCR Extractor", config.ocrModelSrc, true),
        this.createModelStatus(
          "embeddings",
          "Protocol Embeddings",
          config.embeddingsModelSrc,
          false,
        ),
      ],
    };
  }

  async init(): Promise<void> {
    if (this.runtimeStatus.requestedMode === "mock") {
      this.runtimeStatus.models = this.runtimeStatus.models.map((model) => ({
        ...model,
        status: "mocked",
        loaded: false,
        error: undefined,
      }));
      return;
    }

    const initErrors: string[] = [];

    try {
      this.sdk = await import("@qvac/sdk");
    } catch (error) {
      this.applyLiveFallback(
        `Could not import @qvac/sdk: ${this.normalizeError(error)}`,
      );
      return;
    }

    this.llmModelId = await this.loadModel({
      modelType: "llm",
      label: "MedPsy Reasoner",
      modelSrc: this.config.llmModelSrc,
      modelConfig: {
        ctx_size: this.config.ctxSize,
        gpu_layers: this.config.gpuLayers,
      },
    }, initErrors);

    this.whisperModelId = await this.loadModel(
      {
        modelType: "whisper",
        label: "Whisper Transcriber",
        modelSrc: this.config.whisperModelSrc,
        modelConfig: {
          language: "en",
          strategy: "greedy",
        },
      },
      initErrors,
    );

    this.ocrModelId = await this.loadModel(
      {
        modelType: "ocr",
        label: "OCR Extractor",
        modelSrc: this.config.ocrModelSrc,
        modelConfig: {
          langList: ["en"],
          pipelineMode: "easyocr",
          contrastRetry: true,
        },
      },
      initErrors,
    );

    this.embeddingsModelId = await this.loadModel(
      {
        modelType: "embeddings",
        label: "Protocol Embeddings",
        modelSrc: this.config.embeddingsModelSrc,
        modelConfig: {
          batchSize: 64,
          pooling: "mean",
        },
      },
      initErrors,
    );

    if (initErrors.length === 0 && this.llmModelId && this.sdk) {
      try {
        const provider = await this.sdk.startQVACProvider({
          topic: this.config.providerTopic,
        });
        this.runtimeStatus.providerStarted = true;
        this.runtimeStatus.providerPublicKey = provider.publicKey;
      } catch (error) {
        initErrors.push(
          `Provider start failed: ${this.normalizeError(error)}`,
        );
      }
    }

    if (initErrors.length > 0) {
      this.applyLiveFallback(initErrors.join(" | "));
      return;
    }

    this.runtimeStatus.effectiveMode = "live";
    this.runtimeStatus.mode = "live";
    this.runtimeStatus.health = "ready";
    this.runtimeStatus.liveInitError = undefined;
  }

  getStatus(): RuntimeStatus {
    return structuredClone(this.runtimeStatus);
  }

  async extractOcrData(imagePaths: string[]): Promise<OcrExtractionResult> {
    if (!imagePaths.length) {
      return {
        texts: [],
        details: {
          mode: this.runtimeStatus.effectiveMode,
          imageCount: 0,
          ocrStats: [],
        },
      };
    }

    if (this.canUseLiveMode() && this.sdk && this.ocrModelId) {
      const texts: string[] = [];
      const ocrStats: Array<Record<string, unknown>> = [];

      for (const imagePath of imagePaths) {
        const response = this.sdk.ocr({
          modelId: this.ocrModelId,
          image: imagePath,
        }) as {
          blocks: Promise<Array<{ text?: string }>>;
          stats?: Promise<Record<string, unknown> | undefined>;
        };

        const [blocks, stats] = await Promise.all([
          response.blocks,
          response.stats ?? Promise.resolve(undefined),
        ]);

        texts.push(
          blocks
            .map((block) => block.text)
            .filter(Boolean)
            .join(" "),
        );
        ocrStats.push({
          fileName: path.basename(imagePath),
          stats: stats ?? null,
        });
      }

      return {
        texts,
        details: {
          mode: "live",
          imageCount: imagePaths.length,
          ocrStats,
        },
      };
    }

    return {
      texts: imagePaths.map((imagePath, index) => {
        const label = imagePath.split(/[\\/]/).pop() ?? `document-${index + 1}`;
        return `Mock OCR extracted from ${label}: handwritten meds list, referral note, and vitals snapshot.`;
      }),
      details: {
        mode: "mock",
        imageCount: imagePaths.length,
        ocrStats: [],
      },
    };
  }

  async transcribeAudioData(audioPath?: string): Promise<TranscriptResult> {
    if (!audioPath) {
      return {
        text: "",
        details: {
          mode: this.runtimeStatus.effectiveMode,
          hasAudio: false,
        },
      };
    }

    if (this.canUseLiveMode() && this.sdk && this.whisperModelId) {
      const transcript = await this.sdk.transcribe({
        modelId: this.whisperModelId,
        audioChunk: audioPath,
      });

      return {
        text: transcript,
        details: {
          mode: "live",
          hasAudio: true,
          fileName: path.basename(audioPath),
          transcriptionStats: null,
        },
      };
    }

    return {
      text: "Mock voice note: patient transported after acute shortness of breath, anxiety, and repeated confusion. Oxygen started, vitals partially improved, receiving team should reassess airway, SpO2 trend, and medication history.",
      details: {
        mode: "mock",
        hasAudio: true,
        fileName: path.basename(audioPath),
        transcriptionStats: [],
      },
    };
  }

  async summarizeCase({
    packet,
    ocrText,
    transcript,
    citations,
  }: SummaryInput): Promise<SummaryResult> {
    if (this.canUseLiveMode() && this.sdk && this.llmModelId) {
      const prompt = [
        "Return strict JSON for a clinical handoff summary.",
        "Fields: overview, presentingSituation, keyFindings, interventionsCompleted, unresolvedRisks, protocolChecklist, behavioralHealthConsiderations, recommendedHandoffOrder, caution.",
        "Be concise, non-diagnostic, and workflow-focused.",
        `Structured intake: ${JSON.stringify(packet.structuredIntake)}`,
        `OCR text: ${ocrText.join(" | ")}`,
        `Transcript: ${transcript}`,
        `Protocol citations: ${JSON.stringify(citations)}`,
      ].join("\n");

      const result = this.sdk.completion({
        modelId: this.llmModelId,
        history: [{ role: "user", content: prompt }],
      });

      const [rawText, stats] = await Promise.all([result.text, result.stats]);
      const parsed = this.tryParseSummary(rawText);

      if (parsed) {
        return {
          summary: parsed,
          details: {
            mode: "live",
            parsedJson: true,
            completionStats: stats ?? null,
            citationCount: citations.length,
          },
        };
      }

      return {
        summary: this.buildMockSummary({ packet, ocrText, transcript, citations }),
        details: {
          mode: "live",
          parsedJson: false,
          completionStats: stats ?? null,
          citationCount: citations.length,
          rawPreview: rawText.slice(0, 240),
        },
      };
    }

    return {
      summary: this.buildMockSummary({ packet, ocrText, transcript, citations }),
      details: {
        mode: "mock",
        parsedJson: false,
        citationCount: citations.length,
      },
    };
  }

  async answerQuestion(
    question: string,
    summary: HandoffSummary,
    citations: ProtocolCitation[],
  ): Promise<AnswerResult> {
    if (this.canUseLiveMode() && this.sdk && this.llmModelId) {
      const prompt = [
        "Answer the question using only the provided protocol snippets and handoff summary.",
        "Keep it non-diagnostic and say when the source support is thin.",
        `Question: ${question}`,
        `Summary: ${JSON.stringify(summary)}`,
        `Citations: ${JSON.stringify(citations)}`,
      ].join("\n");

      const result = this.sdk.completion({
        modelId: this.llmModelId,
        history: [{ role: "user", content: prompt }],
      });
      const [text, stats] = await Promise.all([result.text, result.stats]);

      return {
        answer: {
          question,
          answer: text,
          grounded: citations.length > 0,
          disclaimer: NON_DIAGNOSTIC_DISCLAIMER,
          citations,
        },
        details: {
          mode: "live",
          grounded: citations.length > 0,
          completionStats: stats ?? null,
          citationCount: citations.length,
        },
      };
    }

    const leadCitation = citations[0];
    const answer = leadCitation
      ? `Based on ${leadCitation.title}, prioritize a concise situation update, confirm completed interventions, and flag what still needs immediate reassessment. For this case, start with ${summary.presentingSituation.toLowerCase()}.`
      : "No protocol snippet matched strongly enough. Reconfirm the basics: identity, situation, vitals trend, interventions already performed, and what the receiving clinician should verify first.";

    return {
      answer: {
        question,
        answer,
        grounded: citations.length > 0,
        disclaimer: NON_DIAGNOSTIC_DISCLAIMER,
        citations,
      },
      details: {
        mode: "mock",
        grounded: citations.length > 0,
        citationCount: citations.length,
      },
    };
  }

  private buildHardwareSummary(): HardwareSummary {
    const cpuModels = os
      .cpus()
      .map((cpu) => cpu.model.trim())
      .filter(Boolean);

    return {
      deviceLabel: this.config.deviceLabel,
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuModel: cpuModels[0] ?? "Unknown CPU",
      cpuCores: os.cpus().length,
      totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      gpuLabel: this.config.gpuLabel,
      collectedAt: new Date().toISOString(),
    };
  }

  private createModelStatus(
    modelType: ModelType,
    name: string,
    source: string | undefined,
    required: boolean,
  ): ModelStatus {
    return {
      name,
      modelType,
      source,
      required,
      status: this.config.qvacMode === "mock" ? "mocked" : "pending",
      loaded: false,
      delegated: false,
    };
  }

  private async loadModel(
    model: ModelLoadConfig,
    initErrors: string[],
  ): Promise<string | undefined> {
    const current = this.getModelStatus(model.modelType);
    if (!this.sdk || !current) {
      return undefined;
    }

    if (!model.modelSrc) {
      if (current.required) {
        const message = `${model.label} source is not configured`;
        initErrors.push(message);
        this.patchModelStatus(model.modelType, {
          status: "failed",
          error: message,
        });
      } else {
        this.patchModelStatus(model.modelType, {
          status: "skipped",
          error: "Optional model not configured",
        });
      }
      return undefined;
    }

    try {
      const modelId = await this.sdk.loadModel({
        modelSrc: model.modelSrc,
        modelType: model.modelType,
        modelConfig: model.modelConfig,
      });

      this.patchModelStatus(model.modelType, {
        status: "loaded",
        loaded: true,
        error: undefined,
        modelId,
      });
      return modelId;
    } catch (error) {
      const message = `${model.label} failed: ${this.normalizeError(error)}`;
      this.patchModelStatus(model.modelType, {
        status: "failed",
        error: message,
      });
      if (current.required) {
        initErrors.push(message);
      }
      return undefined;
    }
  }

  private getModelStatus(modelType: ModelType): ModelStatus | undefined {
    return this.runtimeStatus.models.find((model) => model.modelType === modelType);
  }

  private patchModelStatus(
    modelType: ModelType,
    patch: Partial<ModelStatus>,
  ): void {
    this.runtimeStatus.models = this.runtimeStatus.models.map((model) =>
      model.modelType === modelType
        ? {
            ...model,
            ...patch,
          }
        : model,
    );
  }

  private applyLiveFallback(message: string): void {
    this.runtimeStatus.effectiveMode = "mock";
    this.runtimeStatus.mode = "mock";
    this.runtimeStatus.health = "degraded";
    this.runtimeStatus.providerStarted = false;
    this.runtimeStatus.providerPublicKey = "";
    this.runtimeStatus.liveInitError = message;
  }

  private canUseLiveMode(): boolean {
    return this.runtimeStatus.effectiveMode === "live";
  }

  private normalizeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private tryParseSummary(rawText: string): HandoffSummary | null {
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
      if (
        typeof parsed.overview === "string" &&
        typeof parsed.presentingSituation === "string" &&
        Array.isArray(parsed.keyFindings)
      ) {
        return parsed as HandoffSummary;
      }
    } catch {
      return null;
    }

    return null;
  }

  private buildMockSummary({
    packet,
    ocrText,
    transcript,
    citations,
  }: SummaryInput): HandoffSummary {
    const intake = packet.structuredIntake;
    const protocolChecklist = citations.map((citation) => citation.title);
    const keyFindings = [
      intake.chiefComplaint,
      intake.redFlags,
      ocrText[0],
      transcript.split(".")[0],
    ].filter(Boolean);

    const interventionsCompleted = intake.interventions
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);

    const unresolvedRisks = [
      intake.redFlags,
      intake.medications
        ? "Medication reconciliation should be verified on arrival."
        : "Medication history still needs confirmation.",
    ].filter(Boolean);

    const behavioralHealthConsiderations = intake.mentalHealthContext
      ? [
          intake.mentalHealthContext,
          "Document observable behavior and any de-escalation attempts rather than diagnostic labels.",
        ]
      : ["No behavioral-health context captured yet."];

    return {
      overview: `${intake.chiefComplaint || "Urgent transfer"} captured on-device for ${packet.presetId.replace("-", " ")} handoff.`,
      presentingSituation:
        transcript ||
        intake.notes ||
        "Field team needs a concise receiving-clinician handoff.",
      keyFindings,
      interventionsCompleted,
      unresolvedRisks,
      protocolChecklist:
        protocolChecklist.length > 0
          ? protocolChecklist
          : ["ISBAR Emergency Handoff", "Primary Survey ABCDE"],
      behavioralHealthConsiderations,
      recommendedHandoffOrder: [
        "Identity or alias and immediate situation",
        "Vitals trend and red flags",
        "Interventions already completed",
        "What still needs reassessment",
      ],
      caution: NON_DIAGNOSTIC_DISCLAIMER,
    };
  }
}
