import {
  NON_DIAGNOSTIC_DISCLAIMER,
  type CasePacket,
  type GroundedAnswer,
  type HandoffSummary,
  type ProtocolCitation,
  type RuntimeStatus,
} from "@medmesh/shared";

import type { MedMeshConfig } from "../config.js";

type QvacSdkModule = typeof import("@qvac/sdk");

interface SummaryInput {
  packet: CasePacket;
  ocrText: string[];
  transcript: string;
  citations: ProtocolCitation[];
}

export class QvacRuntime {
  private sdk?: QvacSdkModule;
  private runtimeStatus: RuntimeStatus;
  private llmModelId?: string;
  private whisperModelId?: string;
  private ocrModelId?: string;
  private embeddingsModelId?: string;

  constructor(private readonly config: MedMeshConfig) {
    this.runtimeStatus = {
      mode: config.qvacMode,
      providerStarted: false,
      providerTopic: config.providerTopic,
      providerPublicKey: "",
      models: [
        {
          name: "MedPsy Reasoner",
          modelType: "llm",
          source: config.llmModelSrc,
          loaded: false,
          delegated: false,
        },
        {
          name: "Whisper Transcriber",
          modelType: "whisper",
          source: config.whisperModelSrc,
          loaded: false,
          delegated: false,
        },
        {
          name: "OCR Extractor",
          modelType: "ocr",
          source: config.ocrModelSrc,
          loaded: false,
          delegated: false,
        },
        {
          name: "Protocol Embeddings",
          modelType: "embeddings",
          source: config.embeddingsModelSrc,
          loaded: false,
          delegated: false,
        },
      ],
    };
  }

  async init(): Promise<void> {
    if (this.config.qvacMode !== "live") {
      return;
    }

    try {
      this.sdk = await import("@qvac/sdk");

      if (this.config.llmModelSrc) {
        this.llmModelId = await this.sdk.loadModel({
          modelSrc: this.config.llmModelSrc,
          modelType: "llm",
          modelConfig: {
            ctx_size: this.config.ctxSize,
            gpu_layers: this.config.gpuLayers,
          },
        });
        this.setModelLoaded("llm", true);
      }

      if (this.config.whisperModelSrc) {
        this.whisperModelId = await this.sdk.loadModel({
          modelSrc: this.config.whisperModelSrc,
          modelType: "whisper",
          modelConfig: {
            language: "en",
            strategy: "greedy",
          },
        });
        this.setModelLoaded("whisper", true);
      }

      if (this.config.ocrModelSrc) {
        this.ocrModelId = await this.sdk.loadModel({
          modelSrc: this.config.ocrModelSrc,
          modelType: "ocr",
          modelConfig: {
            langList: ["en"],
            pipelineMode: "easyocr",
            contrastRetry: true,
          },
        });
        this.setModelLoaded("ocr", true);
      }

      if (this.config.embeddingsModelSrc) {
        this.embeddingsModelId = await this.sdk.loadModel({
          modelSrc: this.config.embeddingsModelSrc,
          modelType: "embeddings",
          modelConfig: {
            batchSize: 64,
            pooling: "mean",
          },
        });
        this.setModelLoaded("embeddings", true);
      }

      if (this.llmModelId) {
        const provider = await this.sdk.startQVACProvider({
          topic: this.config.providerTopic,
        });
        this.runtimeStatus.providerStarted = true;
        this.runtimeStatus.providerPublicKey = provider.publicKey;
      }
    } catch (error) {
      console.warn("QVAC live mode failed, falling back to mock mode.", error);
      this.runtimeStatus.mode = "mock";
      this.runtimeStatus.providerStarted = false;
      this.runtimeStatus.providerPublicKey = "";
    }
  }

  getStatus(): RuntimeStatus {
    return structuredClone(this.runtimeStatus);
  }

  async extractOcrText(imagePaths: string[]): Promise<string[]> {
    if (this.runtimeStatus.mode === "live" && this.sdk && this.ocrModelId) {
      const results: string[] = [];

      for (const imagePath of imagePaths) {
        const { blocks } = this.sdk.ocr({
          modelId: this.ocrModelId,
          image: imagePath,
        });
        const resolved = await blocks;
        results.push(
          resolved
            .map((block: { text?: string }) => block.text)
            .filter(Boolean)
            .join(" "),
        );
      }

      return results;
    }

    return imagePaths.map((imagePath, index) => {
      const label = imagePath.split(/[\\/]/).pop() ?? `document-${index + 1}`;
      return `Mock OCR extracted from ${label}: handwritten meds list, referral note, and vitals snapshot.`;
    });
  }

  async transcribeAudio(audioPath?: string): Promise<string> {
    if (!audioPath) {
      return "";
    }

    if (this.runtimeStatus.mode === "live" && this.sdk && this.whisperModelId) {
      return this.sdk.transcribe({
        modelId: this.whisperModelId,
        audioChunk: audioPath,
      });
    }

    return "Mock voice note: patient transported after acute shortness of breath, anxiety, and repeated confusion. Oxygen started, vitals partially improved, receiving team should reassess airway, SpO2 trend, and medication history.";
  }

  async summarizeCase({
    packet,
    ocrText,
    transcript,
    citations,
  }: SummaryInput): Promise<HandoffSummary> {
    if (this.runtimeStatus.mode === "live" && this.sdk && this.llmModelId) {
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

      const rawText = await result.text;
      const parsed = this.tryParseSummary(rawText);
      if (parsed) {
        return parsed;
      }
    }

    return this.buildMockSummary({ packet, ocrText, transcript, citations });
  }

  async answerQuestion(
    question: string,
    summary: HandoffSummary,
    citations: ProtocolCitation[],
  ): Promise<GroundedAnswer> {
    if (this.runtimeStatus.mode === "live" && this.sdk && this.llmModelId) {
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

      return {
        question,
        answer: await result.text,
        grounded: citations.length > 0,
        disclaimer: NON_DIAGNOSTIC_DISCLAIMER,
        citations,
      };
    }

    const leadCitation = citations[0];
    const answer = leadCitation
      ? `Based on ${leadCitation.title}, prioritize a concise situation update, confirm completed interventions, and flag what still needs immediate reassessment. For this case, start with ${summary.presentingSituation.toLowerCase()}.`
      : "No protocol snippet matched strongly enough. Reconfirm the basics: identity, situation, vitals trend, interventions already performed, and what the receiving clinician should verify first.";

    return {
      question,
      answer,
      grounded: citations.length > 0,
      disclaimer: NON_DIAGNOSTIC_DISCLAIMER,
      citations,
    };
  }

  private setModelLoaded(
    modelType: RuntimeStatus["models"][number]["modelType"],
    loaded: boolean,
  ): void {
    const model = this.runtimeStatus.models.find(
      (entry) => entry.modelType === modelType,
    );

    if (model) {
      model.loaded = loaded;
    }
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
