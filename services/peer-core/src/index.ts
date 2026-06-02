import fs from "node:fs";

import { loadConfig } from "./config.js";
import { EvidenceLog } from "./lib/evidence-log.js";
import { JobStore } from "./lib/job-store.js";
import { QvacRuntime } from "./lib/qvac-runtime.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.evidenceDir, { recursive: true });

  const runtime = new QvacRuntime(config);
  await runtime.init();

  const evidence = new EvidenceLog(config.evidenceDir);
  const store = new JobStore(config.dataDir);
  const app = createServer({ config, runtime, store, evidence });

  app.listen(config.port, config.host, () => {
    console.log(
      `MedMesh peer core listening on ${config.host}:${config.port} in ${runtime.getStatus().mode} mode`,
    );
  });
}

main().catch((error) => {
  console.error("Failed to start MedMesh peer core", error);
  process.exit(1);
});
