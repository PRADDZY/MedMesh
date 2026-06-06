import {
  OFFICIAL_QVAC_MODEL_SOURCES,
  describeQvacModelSource,
  type QvacModelSource,
} from "@medmesh/shared";

import type { MedMeshConfig } from "../config.js";

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

function createMedPsyDefaultSource(): QvacModelSource {
  return OFFICIAL_QVAC_MODEL_SOURCES.medPsy17b;
}

function createWhisperTinyDefaultSource(): QvacModelSource {
  return OFFICIAL_QVAC_MODEL_SOURCES.whisperTiny;
}

function createVadSileroDefaultSource(): QvacModelSource {
  return OFFICIAL_QVAC_MODEL_SOURCES.vadSilero512;
}

function createOcrLatinDefaultSource(): QvacModelSource {
  return OFFICIAL_QVAC_MODEL_SOURCES.ocrLatinRecognizer1;
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
  return describeQvacModelSource(source);
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
