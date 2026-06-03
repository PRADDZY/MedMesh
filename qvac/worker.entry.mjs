import process from "bare-process";

import { getServerLogger } from "@qvac/sdk/logging";
import { ocrPlugin } from "@qvac/sdk/onnx-ocr/plugin";
import { registerPlugins } from "@qvac/sdk/plugins";
import { whisperPlugin } from "@qvac/sdk/whispercpp-transcription/plugin";
import { ensureRPCSetup, initializeWorkerCore } from "@qvac/sdk/worker-core";

const { hasRPCConfig } = initializeWorkerCore();
const logger = getServerLogger();
const liveProfile = process.env.MEDMESH_LIVE_PROFILE === "full" ? "full" : "lite";

const plugins = [whisperPlugin, ocrPlugin];

if (liveProfile === "full") {
  const [{ llmPlugin }, { embeddingsPlugin }] = await Promise.all([
    import("@qvac/sdk/llamacpp-completion/plugin"),
    import("@qvac/sdk/llamacpp-embedding/plugin"),
  ]);

  plugins.unshift(embeddingsPlugin);
  plugins.unshift(llmPlugin);
}

registerPlugins(plugins);
logger.info(`MedMesh custom worker booted with ${liveProfile} profile`);

if (hasRPCConfig) {
  ensureRPCSetup();
} else {
  logger.info("MedMesh custom worker running in direct mode");
}
