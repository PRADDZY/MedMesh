import express from "express";

import type { MedMeshConfig } from "./config.js";
import type { EvidenceLog } from "./lib/evidence-log.js";
import type { JobStore } from "./lib/job-store.js";
import type { QvacRuntime } from "./lib/qvac-runtime.js";
import { createApiRouter } from "./routes/api.js";

interface ServerDeps {
  config: MedMeshConfig;
  runtime: QvacRuntime;
  store: JobStore;
  evidence: EvidenceLog;
}

export function createServer({
  config,
  runtime,
  store,
  evidence,
}: ServerDeps): express.Express {
  const app = express();
  app.use(createApiRouter({ config, runtime, store, evidence }));
  return app;
}
