import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

import { loadConfig, resolveProjectPaths } from "../src/config.js";
import {
  buildLiveModelPlan,
  describeModelSource,
  type QvacModelSource,
} from "../src/lib/live-models.js";
import { checkLiveRuntimeSupport } from "../src/lib/live-preflight.js";

type ModelKey = "llm" | "whisper" | "ocr" | "embeddings";

interface ModelTarget {
  key: ModelKey;
  label: string;
  source?: QvacModelSource;
  required: boolean;
  modelConfig?: Record<string, unknown>;
}

interface ProgressEvent {
  timestamp: string;
  progress: Record<string, unknown>;
}

function parseArgs(argv: string[]) {
  const onlyArg = argv.find((arg) => arg.startsWith("--only="));
  const only = onlyArg
    ? new Set(
        onlyArg
          .slice("--only=".length)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean) as ModelKey[],
      )
    : null;

  return {
    dryRun: argv.includes("--dry-run"),
    only,
  };
}

function shouldInclude(key: ModelKey, only: Set<ModelKey> | null) {
  return only ? only.has(key) : true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = resolveProjectPaths();

  dotenv.config({ path: path.join(paths.repoRoot, ".env") });
  dotenv.config({
    path: path.join(paths.serviceRoot, ".env"),
    override: true,
  });

  const config = loadConfig();
  const preflight = checkLiveRuntimeSupport();
  const liveModelPlan = buildLiveModelPlan(config);

  const targets: ModelTarget[] = [
    {
      key: "llm",
      label: "MedPsy Reasoner",
      source: liveModelPlan.llm.source,
      required: true,
      modelConfig: {
        ctx_size: config.ctxSize,
        gpu_layers: config.gpuLayers,
      },
    },
    {
      key: "whisper",
      label: "Whisper Transcriber",
      source: liveModelPlan.whisper.source,
      required: true,
      modelConfig: {
        language: "en",
        strategy: "greedy",
        vadModelSrc: liveModelPlan.vad.source,
      },
    },
    {
      key: "ocr",
      label: "OCR Extractor",
      source: liveModelPlan.ocr.source,
      required: true,
      modelConfig: {
        langList: ["en"],
        pipelineMode: "easyocr",
        contrastRetry: true,
      },
    },
    {
      key: "embeddings",
      label: "Protocol Embeddings",
      source: liveModelPlan.embeddings.source,
      required: false,
      modelConfig: {
        batchSize: 64,
        pooling: "mean",
      },
    },
  ].filter((target) => shouldInclude(target.key, args.only));

  const outputDir = path.join(paths.repoRoot, "artifacts", "validation");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "live-prewarm.json");

  const report = {
    capturedAt: new Date().toISOString(),
    dryRun: args.dryRun,
    preflight,
    ctxSize: config.ctxSize,
    gpuLayers: config.gpuLayers,
    selectedModels: [] as Array<Record<string, unknown>>,
  };

  if (!preflight.ok && !args.dryRun) {
    report.selectedModels = targets.map((target) => ({
      key: target.key,
      label: target.label,
      required: target.required,
      status: target.required ? "blocked" : "skipped",
      source: describeModelSource(target.source) ?? null,
    }));
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error(preflight.error ?? "QVAC live preflight failed");
  }

  const sdk = args.dryRun ? null : await import("@qvac/sdk");

  for (const target of targets) {
    const progressEvents: ProgressEvent[] = [];
    const source = describeModelSource(target.source);

    if (!target.source) {
      report.selectedModels.push({
        key: target.key,
        label: target.label,
        required: target.required,
        status: target.required ? "missing" : "skipped",
        source: source ?? null,
      });
      if (target.required) {
        throw new Error(`${target.label} is still missing a source`);
      }
      continue;
    }

    if (args.dryRun) {
      report.selectedModels.push({
        key: target.key,
        label: target.label,
        required: target.required,
        status: "planned",
        source,
      });
      continue;
    }

    console.log(`Prewarming ${target.label} from ${source}`);
    const startedAt = new Date().toISOString();

    const modelId = await sdk!.loadModel({
      modelSrc: target.source,
      modelType: target.key,
      modelConfig: target.modelConfig,
      onProgress: (progress) => {
        const event = {
          timestamp: new Date().toISOString(),
          progress: progress as Record<string, unknown>,
        };
        progressEvents.push(event);

        const percent =
          typeof progress === "object" &&
          progress &&
          "percent" in progress &&
          typeof (progress as { percent?: unknown }).percent === "number"
            ? Math.round(((progress as { percent: number }).percent) * 100)
            : null;

        if (percent !== null) {
          console.log(`  ${target.key}: ${percent}%`);
        }
      },
    });

    await sdk!.unloadModel({ modelId });

    report.selectedModels.push({
      key: target.key,
      label: target.label,
      required: target.required,
      status: "ready",
      source,
      startedAt,
      completedAt: new Date().toISOString(),
      modelId,
      progressEvents,
    });
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to prewarm live models", error);
  process.exit(1);
});
