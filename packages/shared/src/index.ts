export type ScenarioPresetId =
  | "emergency"
  | "rural-referral"
  | "specialist-consult";

export type AttachmentKind = "document-photo" | "voice-note";
export type RuntimeMode = "mock" | "live";
export type RuntimeHealthState = "ready" | "degraded";
export type LiveProfile = "lite" | "full";
export type ProcessingRoute =
  | "delegated-provider"
  | "peer-local"
  | "skipped";
export type ModelRuntimeState =
  | "pending"
  | "loaded"
  | "failed"
  | "mocked"
  | "skipped";

export type CasePacketStatus =
  | "draft"
  | "saved"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type AnalysisStageName =
  | "normalize"
  | "ocr"
  | "transcribe"
  | "summarize"
  | "ground";

export type AnalysisStageState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface ScenarioPreset {
  id: ScenarioPresetId;
  label: string;
  hero: string;
  handoffTarget: string;
  description: string;
  requiredFields: string[];
  followUpPrompts: string[];
}

export interface VitalsSnapshot {
  heartRate?: string;
  bloodPressure?: string;
  spo2?: string;
  respiratoryRate?: string;
  temperature?: string;
  gcs?: string;
}

export interface StructuredIntake {
  patientAlias: string;
  ageBand: string;
  chiefComplaint: string;
  urgencyLevel: string;
  transportMode: string;
  allergies: string;
  medications: string;
  interventions: string;
  mentalHealthContext: string;
  redFlags: string;
  vitals: VitalsSnapshot;
  notes: string;
}

export interface CaseAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  localUri: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
}

export interface ProcessingPathEntry {
  stage: Extract<AnalysisStageName, "ocr" | "transcribe">;
  route: ProcessingRoute;
  delegated: boolean;
  attemptedDelegation: boolean;
  providerPublicKey?: string;
  consumerDeviceLabel?: string;
  pairingCode?: string;
  requestedAt: string;
  completedAt?: string;
  durationMs?: number;
  heartbeatMs?: number;
  modelLoadMs?: number;
  operationMs?: number;
  note?: string;
  delegationError?: string;
  profilingSummary?: string;
  profiling?: Record<string, unknown>;
}

export interface DelegatedPreprocessing {
  ocrText?: string[];
  transcript?: string;
  processingPath: ProcessingPathEntry[];
}

export interface CasePacket {
  id: string;
  presetId: ScenarioPresetId;
  status: CasePacketStatus;
  captureDeviceLabel: string;
  peerBaseUrl?: string;
  pairingCode?: string;
  providerPublicKey?: string;
  structuredIntake: StructuredIntake;
  attachments: CaseAttachment[];
  delegatedPreprocessing?: DelegatedPreprocessing;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}

export interface PairingSession {
  code: string;
  topic: string;
  providerPublicKey: string;
  providerMode: RuntimeMode;
  baseUrl: string;
  generatedAt: string;
  expiresAt: string;
  qrValue: string;
}

export interface HardwareSummary {
  deviceLabel: string;
  platform: string;
  release: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryGb: number;
  gpuLabel?: string;
  collectedAt: string;
}

export interface ModelStatus {
  name: string;
  modelType: "llm" | "whisper" | "ocr" | "embeddings";
  source?: string;
  modelId?: string;
  required: boolean;
  status: ModelRuntimeState;
  loaded: boolean;
  delegated: boolean;
  error?: string;
}

export interface LivePreflightStatus {
  ok: boolean;
  packageName: string;
  platform: string;
  arch: string;
  failureCode?: string;
  failureStage?: string;
  error?: string;
  resolvedPaths?: {
    sdkPath?: string;
    bareRuntimePath?: string;
    platformRuntimePath?: string;
    requireAssetPath?: string;
    bareBinaryPath?: string;
    customWorkerPath?: string;
  };
}

export interface RuntimeStatus {
  requestedMode: RuntimeMode;
  effectiveMode: RuntimeMode;
  mode: RuntimeMode;
  liveProfile: LiveProfile;
  health: RuntimeHealthState;
  providerStarted: boolean;
  providerTopic: string;
  providerPublicKey: string;
  providerError?: string;
  liveInitError?: string;
  preflight?: LivePreflightStatus;
  hardware: HardwareSummary;
  artifactPaths: {
    dataDir: string;
    evidenceDir: string;
  };
  models: ModelStatus[];
}

export interface AnalysisStage {
  name: AnalysisStageName;
  state: AnalysisStageState;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  note?: string;
}

export interface ProtocolDocument {
  id: string;
  title: string;
  section: string;
  audience: string;
  tags: string[];
  content: string;
}

export interface ProtocolCitation {
  documentId: string;
  title: string;
  section: string;
  snippet: string;
  score?: number;
}

export interface HandoffSummary {
  overview: string;
  presentingSituation: string;
  keyFindings: string[];
  interventionsCompleted: string[];
  unresolvedRisks: string[];
  protocolChecklist: string[];
  behavioralHealthConsiderations: string[];
  recommendedHandoffOrder: string[];
  caution: string;
}

export interface GroundedAnswer {
  question: string;
  answer: string;
  grounded: boolean;
  disclaimer: string;
  citations: ProtocolCitation[];
}

export interface EvidenceEvent {
  id: string;
  timestamp: string;
  type: string;
  jobId?: string;
  casePacketId?: string;
  stage?: AnalysisStageName;
  details: Record<string, unknown>;
}

export interface AnalysisJob {
  id: string;
  casePacketId: string;
  pairingCode: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  inputSummary?: {
    documentCount: number;
    hasVoiceNote: boolean;
    attachmentNames: string[];
  };
  stages: AnalysisStage[];
  runtime: RuntimeStatus;
  processingPath: ProcessingPathEntry[];
  ocrText: string[];
  transcript?: string;
  summary?: HandoffSummary;
  groundedAnswers: GroundedAnswer[];
  evidenceEventIds: string[];
  exportPath?: string;
  errorMessage?: string;
}

export const NON_DIAGNOSTIC_DISCLAIMER =
  "MedMesh is a workflow support tool for handoff, summarization, and grounded retrieval. It does not diagnose, prescribe, or replace clinical judgement.";

export type QvacModelSource =
  | string
  | {
      src: string;
      name?: string;
      [key: string]: unknown;
    };

const MEDPSY_1_7B_REVISION = "fd4cecc90c2de8dce4b112795456a54be9c59363";
const MEDPSY_1_7B_FILE = "medpsy-1.7b-q4_k_m-imat.gguf";
const WHISPER_TINY_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";
const VAD_SILERO_REVISION = "9ffd54a1e1ee413ddf265af9913beaf518d1639b";

export const OFFICIAL_QVAC_MODEL_SOURCES = {
  medPsy17b: {
    src: `https://huggingface.co/qvac/MedPsy-1.7B-GGUF/resolve/${MEDPSY_1_7B_REVISION}/${MEDPSY_1_7B_FILE}`,
    name: "MedPsy 1.7B Q4_K_M (official)",
  } satisfies QvacModelSource,
  whisperTiny: {
    src: `registry://hf/ggerganov/whisper.cpp/resolve/${WHISPER_TINY_REVISION}/ggml-tiny.bin`,
    name: "WHISPER_TINY",
  } satisfies QvacModelSource,
  vadSilero512: {
    src: `registry://hf/ggml-org/whisper-vad/resolve/${VAD_SILERO_REVISION}/ggml-silero-v5.1.2.bin`,
    name: "VAD_SILERO_5_1_2",
  } satisfies QvacModelSource,
  ocrLatinRecognizer1: {
    src: "registry://s3/qvac_models_compiled/ocr/2026-02-12/rec_dyn/recognizer_latin.onnx",
    name: "OCR_LATIN_RECOGNIZER_1",
  } satisfies QvacModelSource,
} as const;

export function describeQvacModelSource(
  source: QvacModelSource | undefined,
): string | undefined {
  if (!source) {
    return undefined;
  }

  return typeof source === "string" ? source : source.src;
}

export function mergeProcessingPath(
  current: ProcessingPathEntry[],
  next: ProcessingPathEntry,
): ProcessingPathEntry[] {
  const otherEntries = current.filter((entry) => entry.stage !== next.stage);
  const existing = current.find((entry) => entry.stage === next.stage);

  return [
    ...otherEntries,
    {
      ...existing,
      ...next,
      attemptedDelegation:
        next.attemptedDelegation || existing?.attemptedDelegation || false,
      delegated: next.delegated,
      requestedAt: next.requestedAt ?? existing?.requestedAt ?? new Date().toISOString(),
    },
  ].sort((left, right) => left.stage.localeCompare(right.stage));
}

export const REMOTE_API_MANIFEST = {
  aiServices: [] as string[],
  utilityServices: [] as string[],
  notes:
    "MedMesh keeps AI workloads on-device or on trusted peer hardware. Optional utilities should be disclosed in deployment docs.",
};

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "emergency",
    label: "Emergency Handoff",
    hero: "Ambulance or unstable patient transfer",
    handoffTarget: "Receiving ED clinician",
    description:
      "Fast capture for urgent scenes with sparse connectivity and high-pressure handoff needs.",
    requiredFields: [
      "chiefComplaint",
      "urgencyLevel",
      "transportMode",
      "redFlags",
    ],
    followUpPrompts: [
      "What should the receiving clinician verify first?",
      "What details are still missing for a safe ED handoff?",
    ],
  },
  {
    id: "rural-referral",
    label: "Rural Referral",
    hero: "Community health worker to district clinic",
    handoffTarget: "Referral nurse or clinician",
    description:
      "Longer intake with document photos, referral context, and local-first continuity of care.",
    requiredFields: [
      "chiefComplaint",
      "medications",
      "notes",
      "mentalHealthContext",
    ],
    followUpPrompts: [
      "What referral packet elements should be confirmed before transport?",
      "What context should the receiving clinic know first?",
    ],
  },
  {
    id: "specialist-consult",
    label: "Specialist Consult",
    hero: "Ward or clinic escalation",
    handoffTarget: "Consulting specialist",
    description:
      "Structured summary for a private consult with imaging notes, current meds, and open questions.",
    requiredFields: [
      "chiefComplaint",
      "medications",
      "interventions",
      "vitals",
    ],
    followUpPrompts: [
      "What should be highlighted before the specialist reads the chart?",
      "Which unresolved questions need explicit handoff?",
    ],
  },
];

export const EMPTY_STRUCTURED_INTAKE: StructuredIntake = {
  patientAlias: "",
  ageBand: "",
  chiefComplaint: "",
  urgencyLevel: "",
  transportMode: "",
  allergies: "",
  medications: "",
  interventions: "",
  mentalHealthContext: "",
  redFlags: "",
  vitals: {},
  notes: "",
};

export function createId(prefix = "medmesh"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function createDraftCasePacket(
  presetId: ScenarioPresetId = "emergency",
): CasePacket {
  const now = new Date().toISOString();

  return {
    id: createId("case"),
    presetId,
    status: "draft",
    captureDeviceLabel: "Android handset",
    structuredIntake: { ...EMPTY_STRUCTURED_INTAKE, vitals: {} },
    attachments: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function getScenarioPreset(
  presetId: ScenarioPresetId,
): ScenarioPreset {
  return (
    SCENARIO_PRESETS.find((preset) => preset.id === presetId) ??
    SCENARIO_PRESETS[0]
  );
}
