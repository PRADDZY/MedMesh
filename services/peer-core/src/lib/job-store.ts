import fs from "node:fs";
import path from "node:path";

import type { AnalysisJob } from "@medmesh/shared";

export class JobStore {
  private readonly jobs = new Map<string, AnalysisJob>();
  private readonly jobsDir: string;

  constructor(dataDir: string) {
    this.jobsDir = path.join(dataDir, "jobs");
    fs.mkdirSync(this.jobsDir, { recursive: true });
    this.loadExisting();
  }

  private loadExisting(): void {
    for (const entry of fs.readdirSync(this.jobsDir)) {
      if (!entry.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(this.jobsDir, entry);
      const job = JSON.parse(fs.readFileSync(filePath, "utf8")) as AnalysisJob;
      this.jobs.set(job.id, job);
    }
  }

  private write(job: AnalysisJob): void {
    this.jobs.set(job.id, job);
    fs.writeFileSync(
      path.join(this.jobsDir, `${job.id}.json`),
      JSON.stringify(job, null, 2),
      "utf8",
    );
  }

  upsert(job: AnalysisJob): AnalysisJob {
    this.write(job);
    return job;
  }

  get(jobId: string): AnalysisJob | undefined {
    return this.jobs.get(jobId);
  }

  list(): AnalysisJob[] {
    return [...this.jobs.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }
}
