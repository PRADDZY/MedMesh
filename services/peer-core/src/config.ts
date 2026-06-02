import path from "node:path";

export interface MedMeshConfig {
  host: string;
  port: number;
  appUrl: string;
  dataDir: string;
  evidenceDir: string;
  qvacMode: "mock" | "live";
  providerTopic: string;
  llmModelSrc?: string;
  whisperModelSrc?: string;
  ocrModelSrc?: string;
  embeddingsModelSrc?: string;
  ctxSize: number;
  gpuLayers: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): MedMeshConfig {
  const cwd = process.cwd();
  const host = process.env.MEDMESH_HOST ?? "0.0.0.0";
  const port = parseNumber(process.env.MEDMESH_PORT, 4747);
  const appUrl = process.env.MEDMESH_APP_URL ?? `http://localhost:${port}`;
  const dataDir = process.env.MEDMESH_DATA_DIR ?? path.join(cwd, "data");
  const evidenceDir =
    process.env.MEDMESH_EVIDENCE_DIR ?? path.join(cwd, "artifacts", "evidence");

  return {
    host,
    port,
    appUrl,
    dataDir,
    evidenceDir,
    qvacMode: process.env.MEDMESH_QVAC_MODE === "live" ? "live" : "mock",
    providerTopic:
      process.env.MEDMESH_PROVIDER_TOPIC ??
      "6d65646d6573682d706565722d746f7069632d64656d6f".padEnd(64, "0"),
    llmModelSrc: process.env.MEDMESH_LLM_MODEL_SRC,
    whisperModelSrc: process.env.MEDMESH_WHISPER_MODEL_SRC,
    ocrModelSrc: process.env.MEDMESH_OCR_MODEL_SRC,
    embeddingsModelSrc: process.env.MEDMESH_EMBED_MODEL_SRC,
    ctxSize: parseNumber(process.env.MEDMESH_CTX_SIZE, 4096),
    gpuLayers: parseNumber(process.env.MEDMESH_GPU_LAYERS, 40),
  };
}
