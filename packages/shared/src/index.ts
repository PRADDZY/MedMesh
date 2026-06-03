export type ScenarioPresetId =
  | "emergency"
  | "rural-referral"
  | "specialist-consult";

export type AttachmentKind = "document-photo" | "voice-note";
export type RuntimeMode = "mock" | "live";
export type RuntimeHealthState = "ready" | "degraded";
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

export interface CasePacket {
  id: string;
  presetId: ScenarioPresetId;
  status: CasePacketStatus;
  captureDeviceLabel: string;
  peerBaseUrl?: string;
  pairingCode?: string;
  structuredIntake: StructuredIntake;
  attachments: CaseAttachment[];
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

export interface RuntimeStatus {
  requestedMode: RuntimeMode;
  effectiveMode: RuntimeMode;
  mode: RuntimeMode;
  health: RuntimeHealthState;
  providerStarted: boolean;
  providerTopic: string;
  providerPublicKey: string;
  liveInitError?: string;
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
  stages: AnalysisStage[];
  runtime: RuntimeStatus;
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

export const REMOTE_API_MANIFEST = {
  aiServices: [] as string[],
  utilityServices: [] as string[],
  notes:
    "MedMesh keeps AI workloads on-device or on trusted peer hardware. Optional utilities should be disclosed before submission.",
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
