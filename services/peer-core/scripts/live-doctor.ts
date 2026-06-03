import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

import { loadConfig, resolveProjectPaths } from "../src/config.js";
import { buildLiveModelPlan, describeModelSource } from "../src/lib/live-models.js";
import { checkLiveRuntimeSupport } from "../src/lib/live-preflight.js";

interface WorkerProbeResult {
  profile: "lite" | "full";
  booted: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
}

async function probeWorker(
  barePath: string | undefined,
  workerPath: string | undefined,
  profile: "lite" | "full",
): Promise<WorkerProbeResult> {
  if (!barePath || !workerPath) {
    return {
      profile,
      booted: false,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: "Missing bare binary path or worker entry path",
    };
  }

  if (!fs.existsSync(workerPath)) {
    return {
      profile,
      booted: false,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: `Worker entry was not found at ${workerPath}`,
    };
  }

  return new Promise<WorkerProbeResult>((resolve) => {
    const child = spawn(barePath, [workerPath, "{}"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MEDMESH_LIVE_PROFILE: profile,
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: WorkerProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({
        profile,
        booted: false,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.on("exit", (code, signal) => {
      finish({
        profile,
        booted: false,
        exitCode: code,
        signal,
        stdout,
        stderr,
      });
    });

    setTimeout(() => {
      if (settled) {
        return;
      }

      child.kill("SIGTERM");
      finish({
        profile,
        booted: true,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
      });
    }, 4000);
  });
}

async function main() {
  const paths = resolveProjectPaths();
  dotenv.config({ path: path.join(paths.repoRoot, ".env") });
  dotenv.config({
    path: path.join(paths.serviceRoot, ".env"),
    override: true,
  });
  process.env.MEDMESH_QVAC_MODE = process.env.MEDMESH_QVAC_MODE ?? "live";
  process.env.QVAC_WORKER_PATH =
    process.env.QVAC_WORKER_PATH ??
    path.join(paths.repoRoot, "qvac", "worker.entry.mjs");

  const config = loadConfig();
  const preflight = checkLiveRuntimeSupport();
  const liveModelPlan = buildLiveModelPlan(config);
  const outputDir = path.join(paths.repoRoot, "artifacts", "validation");
  const outputPath = path.join(outputDir, "live-doctor.json");
  fs.mkdirSync(outputDir, { recursive: true });

  const workerPath = path.join(paths.repoRoot, "qvac", "worker.entry.mjs");
  const barePath = preflight.resolvedPaths?.bareBinaryPath;

  const [liteWorkerProbe, fullWorkerProbe] = await Promise.all([
    probeWorker(barePath, workerPath, "lite"),
    probeWorker(barePath, workerPath, "full"),
  ]);

  const report = {
    capturedAt: new Date().toISOString(),
    requestedMode: config.qvacMode,
    liveProfile: config.liveProfile,
    workerEntryPath: workerPath,
    preflight,
    selectedModels: {
      llm: describeModelSource(liveModelPlan.llm.source) ?? null,
      whisper: describeModelSource(liveModelPlan.whisper.source) ?? null,
      vad: describeModelSource(liveModelPlan.vad.source) ?? null,
      ocr: describeModelSource(liveModelPlan.ocr.source) ?? null,
      embeddings: describeModelSource(liveModelPlan.embeddings.source) ?? null,
    },
    probes: {
      liteWorker: liteWorkerProbe,
      fullWorker: fullWorkerProbe,
    },
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("Failed to run live doctor", error);
  process.exit(1);
});
