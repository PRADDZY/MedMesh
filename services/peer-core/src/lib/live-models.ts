import type { MedMeshConfig } from "../config.js";

export type QvacModelSource =
  | string
  | {
      src: string;
      name?: string;
      [key: string]: unknown;
    };

type ModelSourceOrigin = "env" | "official-default" | "disabled";

export interface ResolvedModelSource {
  source?: QvacModelSource;
  sourceLabel?: string;
  origin: ModelSourceOrigin;
}

export interface LiveModelPlan {
  llm: ResolvedModelSource;
  whisper: ResolvedModelSource;
  vad: ResolvedModelSource;
  ocr: ResolvedModelSource;
  embeddings: ResolvedModelSource;
}

const MEDPSY_1_7B_REVISION = "fd4cecc90c2de8dce4b112795456a54be9c59363";
const MEDPSY_1_7B_FILE = "medpsy-1.7b-q4_k_m-imat.gguf";
const WHISPER_TINY_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";
const VAD_SILERO_REVISION = "9ffd54a1e1ee413ddf265af9913beaf518d1639b";

function createMedPsyDefaultSource(): QvacModelSource {
  return {
    src: `https://huggingface.co/qvac/MedPsy-1.7B-GGUF/resolve/${MEDPSY_1_7B_REVISION}/${MEDPSY_1_7B_FILE}`,
    name: "MedPsy 1.7B Q4_K_M (official)",
  };
}

function createWhisperTinyDefaultSource(): QvacModelSource {
  return {
    src: `registry://hf/ggerganov/whisper.cpp/resolve/${WHISPER_TINY_REVISION}/ggml-tiny.bin`,
    name: "WHISPER_TINY",
  };
}

function createVadSileroDefaultSource(): QvacModelSource {
  return {
    src: `registry://hf/ggml-org/whisper-vad/resolve/${VAD_SILERO_REVISION}/ggml-silero-v5.1.2.bin`,
    name: "VAD_SILERO_5_1_2",
  };
}

function createOcrLatinDefaultSource(): QvacModelSource {
  return {
    src: "registry://s3/qvac_models_compiled/ocr/2026-02-12/rec_dyn/recognizer_latin.onnx",
    name: "OCR_LATIN_RECOGNIZER_1",
  };
}

function resolveSource(
  preferred: string | undefined,
  fallback: QvacModelSource | undefined,
): ResolvedModelSource {
  if (preferred) {
    return {
      source: preferred,
      sourceLabel: preferred,
      origin: "env",
    };
  }

  if (!fallback) {
    return {
      origin: "disabled",
    };
  }

  return {
    source: fallback,
    sourceLabel: describeModelSource(fallback),
    origin: "official-default",
  };
}

export function describeModelSource(
  source: QvacModelSource | undefined,
): string | undefined {
  if (!source) {
    return undefined;
  }

  return typeof source === "string" ? source : source.src;
}

export function buildLiveModelPlan(config: MedMeshConfig): LiveModelPlan {
  const fullProfile = config.liveProfile === "full";

  return {
    llm: resolveSource(
      config.llmModelSrc,
      fullProfile ? createMedPsyDefaultSource() : undefined,
    ),
    whisper: resolveSource(config.whisperModelSrc, createWhisperTinyDefaultSource()),
    vad: resolveSource(config.vadModelSrc, createVadSileroDefaultSource()),
    ocr: resolveSource(config.ocrModelSrc, createOcrLatinDefaultSource()),
    embeddings: resolveSource(config.embeddingsModelSrc, undefined),
  };
}
