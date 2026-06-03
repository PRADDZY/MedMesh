import fs from "node:fs";
import path from "node:path";

import cors from "cors";
import express from "express";
import multer from "multer";
import { z } from "zod";

import {
  NON_DIAGNOSTIC_DISCLAIMER,
  REMOTE_API_MANIFEST,
  type AnalysisJob,
  type CasePacket,
} from "@medmesh/shared";

import type { MedMeshConfig } from "../config.js";
import type { EvidenceLog } from "../lib/evidence-log.js";
import type { JobStore } from "../lib/job-store.js";
import { runAnalysisJob } from "../lib/pipeline.js";
import { ensurePairingSession } from "../lib/pairing.js";
import type { QvacRuntime } from "../lib/qvac-runtime.js";

const packetSchema = z.object({
  id: z.string(),
  presetId: z.enum(["emergency", "rural-referral", "specialist-consult"]),
  status: z.string(),
  captureDeviceLabel: z.string(),
  peerBaseUrl: z.string().optional(),
  pairingCode: z.string().optional(),
  structuredIntake: z.object({
    patientAlias: z.string(),
    ageBand: z.string(),
    chiefComplaint: z.string(),
    urgencyLevel: z.string(),
    transportMode: z.string(),
    allergies: z.string(),
    medications: z.string(),
    interventions: z.string(),
    mentalHealthContext: z.string(),
    redFlags: z.string(),
    vitals: z.record(z.string(), z.string()).catch({}),
    notes: z.string(),
  }),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["document-photo", "voice-note"]),
        name: z.string(),
        localUri: z.string(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
        createdAt: z.string(),
      }),
    )
    .default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  submittedAt: z.string().optional(),
});

interface RouterDeps {
  config: MedMeshConfig;
  runtime: QvacRuntime;
  store: JobStore;
  evidence: EvidenceLog;
}

export function createApiRouter({
  config,
  runtime,
  store,
  evidence,
}: RouterDeps): express.Router {
  const router = express.Router();
  const uploadDir = path.join(config.dataDir, "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => callback(null, uploadDir),
      filename: (_request, file, callback) => {
        const safeName = file.originalname.replace(/[^\w.-]/g, "_");
        callback(null, `${Date.now()}-${safeName}`);
      },
    }),
  });

  router.use(cors());
  router.use(express.json({ limit: "8mb" }));

  router.get("/health", (_request, response) => {
    const pairing = ensurePairingSession(
      config.dataDir,
      config.appUrl,
      runtime.getStatus(),
    );
    response.json({
      ok: true,
      app: "MedMesh Peer Core",
      disclaimer: NON_DIAGNOSTIC_DISCLAIMER,
      runtime: runtime.getStatus(),
      pairing,
      remoteApis: REMOTE_API_MANIFEST,
      jobCount: store.list().length,
      artifactPaths: runtime.getStatus().artifactPaths,
    });
  });

  router.get("/api/pairing-session", (_request, response) => {
    response.json(
      ensurePairingSession(config.dataDir, config.appUrl, runtime.getStatus()),
    );
  });

  router.get("/api/jobs", (_request, response) => {
    response.json(store.list());
  });

  router.get("/api/jobs/:jobId", (request, response) => {
    const job = store.get(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }

    response.json(job);
  });

  router.post(
    "/api/jobs",
    upload.fields([
      { name: "documents", maxCount: 8 },
      { name: "voiceNote", maxCount: 1 },
    ]),
    async (request, response) => {
      const packetRaw = request.body.packet;
      if (!packetRaw || typeof packetRaw !== "string") {
        response.status(400).json({ error: "Missing packet payload" });
        return;
      }

      let packet: CasePacket;
      try {
        packet = packetSchema.parse(JSON.parse(packetRaw)) as CasePacket;
      } catch (error) {
        response.status(400).json({
          error: "Invalid packet payload",
          detail: error instanceof Error ? error.message : "Unknown parse error",
        });
        return;
      }

      const files = request.files as
        | {
            documents?: Express.Multer.File[];
            voiceNote?: Express.Multer.File[];
          }
        | undefined;
      const documentPaths = files?.documents?.map((file) => file.path) ?? [];
      const voiceNotePath = files?.voiceNote?.[0]?.path;

      const runtimeStatus = runtime.getStatus();
      const pairing = ensurePairingSession(
        config.dataDir,
        config.appUrl,
        runtimeStatus,
      );
      const createdAt = new Date().toISOString();
      let job: AnalysisJob = {
        id: crypto.randomUUID(),
        casePacketId: packet.id,
        pairingCode: packet.pairingCode ?? pairing.code,
        status: "queued",
        createdAt,
        updatedAt: createdAt,
        stages: [
          { name: "normalize", state: "pending" },
          { name: "ocr", state: "pending" },
          { name: "transcribe", state: "pending" },
          { name: "summarize", state: "pending" },
          { name: "ground", state: "pending" },
        ],
        runtime: runtimeStatus,
        ocrText: [],
        groundedAnswers: [],
        evidenceEventIds: [],
      };
      store.upsert(job);

      const event = evidence.append({
        type: "job.created",
        jobId: job.id,
        casePacketId: packet.id,
        details: {
          presetId: packet.presetId,
          documentCount: documentPaths.length,
          hasVoiceNote: Boolean(voiceNotePath),
          pairingCode: job.pairingCode,
          requestedMode: runtimeStatus.requestedMode,
          effectiveMode: runtimeStatus.effectiveMode,
          evidenceDir: runtimeStatus.artifactPaths.evidenceDir,
        },
      });
      job = {
        ...job,
        evidenceEventIds: [...job.evidenceEventIds, event.id],
      };
      store.upsert(job);

      void runAnalysisJob(
        {
          store,
          evidence,
          runtime,
          evidenceDir: config.evidenceDir,
        },
        job,
        packet,
        {
          documentPaths,
          voiceNotePath,
        },
      );

      response.status(202).json(job);
    },
  );

  router.post("/api/jobs/:jobId/questions", async (request, response) => {
    const job = store.get(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }

    const parsed = z.object({ question: z.string().min(4) }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Question is required" });
      return;
    }

    if (!job.summary) {
      response.status(409).json({ error: "Job summary is not ready yet" });
      return;
    }

    const answerResult = await runtime.answerQuestion(
      parsed.data.question,
      job.summary,
      job.groundedAnswers[0]?.citations ?? [],
    );
    const updated = {
      ...job,
      groundedAnswers: [...job.groundedAnswers, answerResult.answer],
      updatedAt: new Date().toISOString(),
    };
    store.upsert(updated);
    evidence.append({
      type: "grounded-answer.created",
      jobId: job.id,
      casePacketId: job.casePacketId,
      stage: "ground",
      details: {
        question: parsed.data.question,
        ...answerResult.details,
      },
    });

    response.json(updated);
  });

  router.get("/api/jobs/:jobId/export", (request, response) => {
    const job = store.get(request.params.jobId);
    if (!job?.exportPath || !fs.existsSync(job.exportPath)) {
      response.status(404).json({ error: "Export not ready" });
      return;
    }

    response.type("text/markdown").send(fs.readFileSync(job.exportPath, "utf8"));
  });

  router.get("/api/evidence/events", (_request, response) => {
    response.json(evidence.readAll());
  });

  return router;
}
