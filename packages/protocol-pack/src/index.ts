import type { ProtocolDocument } from "@medmesh/shared";

export const protocolDocuments: ProtocolDocument[] = [
  {
    id: "isbar-emergency-handoff",
    title: "ISBAR Emergency Handoff",
    section: "Identity Situation Background Assessment Recommendation",
    audience: "Prehospital and emergency clinicians",
    tags: ["handoff", "isbar", "triage", "communication"],
    content:
      "Start with patient identity or alias, immediate situation, and current urgency. Follow with concise background including known meds, allergies, and major context. State your assessment in plain language, including vitals, red flags, and what changed during transport. End with a clear recommendation: what the receiving team should verify first, what interventions already happened, and what remains unresolved.",
  },
  {
    id: "primary-survey-abcde",
    title: "Primary Survey ABCDE",
    section: "Airway Breathing Circulation Disability Exposure",
    audience: "Emergency and field teams",
    tags: ["abcde", "airway", "trauma", "emergency"],
    content:
      "Use a consistent primary survey: confirm airway patency, assess breathing quality and oxygenation, review circulation and obvious bleeding, document disability or neurological status, and complete exposure with temperature or scene concerns. If any domain is unstable, note the intervention already performed and what the receiving clinician needs to reassess immediately.",
  },
  {
    id: "behavioral-emergency-deescalation",
    title: "Behavioral Emergency De-escalation",
    section: "Safety Communication and Escalation",
    audience: "Clinicians, medics, and support staff",
    tags: ["psy", "mental-health", "de-escalation", "safety"],
    content:
      "When agitation, confusion, or psych distress is present, document observable behavior instead of labels. Note orientation, threats to self or others, known triggers, and calming strategies already attempted. Use short, concrete language and minimize confrontation. Escalate immediately if there is weapon access, severe disorganization, inability to protect airway, or concern for self-harm or violence.",
  },
  {
    id: "medication-reconciliation-minimums",
    title: "Medication Reconciliation Minimums",
    section: "Transfer-safe med summary",
    audience: "Receiving clinicians",
    tags: ["medications", "allergies", "transfer", "reconciliation"],
    content:
      "Every transfer packet should capture current meds if known, allergies, last dose timing when available, and any medication changes or administrations during transport. If certainty is low, state that uncertainty clearly so the receiving team knows what to verify instead of assuming accuracy.",
  },
  {
    id: "rural-referral-minimum-dataset",
    title: "Rural Referral Minimum Dataset",
    section: "Continuity checklist",
    audience: "Community health workers and clinic staff",
    tags: ["referral", "continuity", "documents", "follow-up"],
    content:
      "A safe referral packet includes a summary of the presenting problem, relevant history, meds and allergies, vitals if available, recent documents or lab photos, transportation constraints, and a plain note describing why escalation is happening now. State any barriers such as language, mental health concerns, or caregiver limitations so the receiving site can plan appropriately.",
  },
];

export function getProtocolDocument(id: string): ProtocolDocument | undefined {
  return protocolDocuments.find((document) => document.id === id);
}
