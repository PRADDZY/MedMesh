import { StatusBar } from "expo-status-bar";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useEffect, useMemo, useState } from "react";

import {
  createId,
  createDraftCasePacket,
  getScenarioPreset,
  NON_DIAGNOSTIC_DISCLAIMER,
  SCENARIO_PRESETS,
  type AnalysisJob,
  type CaseAttachment,
  type CasePacket,
  type ScenarioPresetId,
} from "@medmesh/shared";

import { askGroundedQuestion, pingPeer, submitCasePacket } from "./src/api";
import { storeLocalFile } from "./src/files";
import { initCaseStore, listSavedCasePackets, saveCasePacket } from "./src/storage";

function attachmentLabel(attachment: CaseAttachment): string {
  return `${attachment.kind === "voice-note" ? "Voice" : "Doc"} · ${attachment.name}`;
}

function trimBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function formatPeerStatus(health: Awaited<ReturnType<typeof pingPeer>>): string {
  const modeSummary = `${health.runtime.requestedMode} requested / ${health.runtime.effectiveMode} effective`;
  const issue = health.runtime.liveInitError
    ? ` · degraded: ${health.runtime.liveInitError}`
    : "";
  return `${health.app} · ${modeSummary} · code ${health.pairing.code}${issue}`;
}

function App() {
  const [packet, setPacket] = useState<CasePacket>(() => createDraftCasePacket());
  const [savedPackets, setSavedPackets] = useState<CasePacket[]>([]);
  const [peerBaseUrl, setPeerBaseUrl] = useState("http://localhost:4747");
  const [pairingCode, setPairingCode] = useState("");
  const [peerStatus, setPeerStatus] = useState("Not checked");
  const [activeJob, setActiveJob] = useState<AnalysisJob | null>(null);
  const [question, setQuestion] = useState("");
  const [busyLabel, setBusyLabel] = useState("");

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const currentPreset = useMemo(
    () => getScenarioPreset(packet.presetId),
    [packet.presetId],
  );

  useEffect(() => {
    void (async () => {
      await initCaseStore();
      setSavedPackets(await listSavedCasePackets());
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
    })();
  }, []);

  useEffect(() => {
    if (!activeJob || activeJob.status === "completed" || activeJob.status === "failed") {
      return;
    }

    const timer = setInterval(() => {
      void pollActiveJob(activeJob.id);
    }, 3000);

    return () => clearInterval(timer);
  }, [activeJob]);

  async function pollActiveJob(jobId: string): Promise<void> {
    try {
      const health = await pingPeer(trimBaseUrl(peerBaseUrl));
      const response = await fetch(`${trimBaseUrl(peerBaseUrl)}/api/jobs/${jobId}`);
      const job = (await response.json()) as AnalysisJob;
      setPeerStatus(formatPeerStatus(health));
      setActiveJob(job);
    } catch (error) {
      setPeerStatus(
        error instanceof Error ? error.message : "Could not refresh peer status",
      );
    }
  }

  function updatePacket(mutator: (current: CasePacket) => CasePacket): void {
    setPacket((current) => {
      const next = mutator(current);
      return { ...next, updatedAt: new Date().toISOString() };
    });
  }

  async function handleSaveLocal(): Promise<void> {
    const nextPacket = {
      ...packet,
      status: "saved" as const,
      peerBaseUrl: trimBaseUrl(peerBaseUrl),
      pairingCode,
      updatedAt: new Date().toISOString(),
    };
    await saveCasePacket(nextPacket);
    setPacket(nextPacket);
    setSavedPackets(await listSavedCasePackets());
    Alert.alert("Saved locally", "Case packet is stored on-device for offline use.");
  }

  async function handlePickDocument(mode: "library" | "camera"): Promise<void> {
    setBusyLabel(mode === "camera" ? "Opening camera…" : "Opening library…");
    try {
      const permission =
        mode === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission needed", "MedMesh needs access to attach document photos.");
        return;
      }

      const result =
        mode === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              quality: 0.8,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 0.8,
              allowsMultipleSelection: true,
              selectionLimit: 4,
            });

      if (result.canceled) {
        return;
      }

      const attachments = result.assets.map((asset, index) => {
        const fileName =
          asset.fileName ?? `document-${Date.now()}-${index + 1}.jpg`;
        const storedUri = storeLocalFile(packet.id, asset.uri, fileName);

        return {
          id: createId("attachment"),
          kind: "document-photo" as const,
          name: fileName,
          localUri: storedUri,
          mimeType: asset.mimeType ?? "image/jpeg",
          size: asset.fileSize ?? undefined,
          createdAt: new Date().toISOString(),
        };
      });

      updatePacket((current) => ({
        ...current,
        attachments: [...current.attachments, ...attachments],
      }));
    } finally {
      setBusyLabel("");
    }
  }

  async function handleToggleRecording(): Promise<void> {
    if (recorderState.isRecording) {
      setBusyLabel("Saving voice note…");
      try {
        await recorder.stop();
        if (!recorder.uri) {
          return;
        }

        const fileName = `voice-note-${Date.now()}.m4a`;
        const storedUri = storeLocalFile(packet.id, recorder.uri, fileName);
        const voiceAttachment: CaseAttachment = {
          id: createId("voice"),
          kind: "voice-note",
          name: fileName,
          localUri: storedUri,
          mimeType: "audio/m4a",
          createdAt: new Date().toISOString(),
        };

        updatePacket((current) => ({
          ...current,
          attachments: [
            ...current.attachments.filter(
              (attachment) => attachment.kind !== "voice-note",
            ),
            voiceAttachment,
          ],
        }));
      } finally {
        setBusyLabel("");
      }

      return;
    }

    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Microphone access is required for voice handoff notes.");
      return;
    }

    setBusyLabel("Recording voice note…");
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } finally {
      setBusyLabel("");
    }
  }

  async function handleCheckPeer(): Promise<void> {
    setBusyLabel("Checking peer…");
    try {
      const response = await pingPeer(trimBaseUrl(peerBaseUrl));
      setPeerStatus(formatPeerStatus(response));
      if (!pairingCode) {
        setPairingCode(response.pairing.code);
      }
    } catch (error) {
      setPeerStatus(error instanceof Error ? error.message : "Peer check failed");
    } finally {
      setBusyLabel("");
    }
  }

  async function handleSubmit(): Promise<void> {
    const baseUrl = trimBaseUrl(peerBaseUrl);
    if (!baseUrl) {
      Alert.alert("Peer missing", "Enter the nearby peer URL first.");
      return;
    }

    setBusyLabel("Submitting to peer…");
    try {
      const nextPacket = {
        ...packet,
        status: "queued" as const,
        peerBaseUrl: baseUrl,
        pairingCode,
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const job = await submitCasePacket(baseUrl, nextPacket);
      setPacket(nextPacket);
      setActiveJob(job);
      await saveCasePacket(nextPacket);
      setSavedPackets(await listSavedCasePackets());
    } catch (error) {
      Alert.alert(
        "Submit failed",
        error instanceof Error ? error.message : "Could not submit case packet.",
      );
    } finally {
      setBusyLabel("");
    }
  }

  async function handleAskQuestion(): Promise<void> {
    if (!activeJob || !question.trim()) {
      return;
    }

    setBusyLabel("Asking grounded question…");
    try {
      const updated = await askGroundedQuestion(
        trimBaseUrl(peerBaseUrl),
        activeJob.id,
        question.trim(),
      );
      setActiveJob(updated);
      setQuestion("");
    } catch (error) {
      Alert.alert(
        "Question failed",
        error instanceof Error ? error.message : "Could not fetch grounded answer.",
      );
    } finally {
      setBusyLabel("");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>MedMesh Handoff</Text>
          <Text style={styles.title}>Mobile-first intake for private emergency handoff</Text>
          <Text style={styles.lede}>
            Capture a structured case, attach paperwork, record a quick voice note,
            then hand the bundle to a nearby peer device for OCR, summarization,
            and protocol-grounded follow-ups.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Scenario presets</Text>
          <View style={styles.chipRow}>
            {SCENARIO_PRESETS.map((preset) => (
              <Pressable
                key={preset.id}
                onPress={() =>
                  updatePacket((current) => ({
                    ...current,
                    presetId: preset.id,
                  }))
                }
                style={[
                  styles.chip,
                  packet.presetId === preset.id && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    packet.presetId === preset.id && styles.chipTextActive,
                  ]}
                >
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.helperText}>{currentPreset.description}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Nearby peer</Text>
          <Field
            label="Peer base URL"
            value={peerBaseUrl}
            onChangeText={setPeerBaseUrl}
            placeholder="http://192.168.1.10:4747"
          />
          <Field
            label="Pairing code"
            value={pairingCode}
            onChangeText={setPairingCode}
            placeholder="Shown on the peer console"
          />
          <Text style={styles.helperText}>{peerStatus}</Text>
          <Pressable onPress={handleCheckPeer} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Check peer status</Text>
          </Pressable>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Structured intake</Text>
          <Field
            label="Patient alias"
            value={packet.structuredIntake.patientAlias}
            onChangeText={(value) =>
              updatePacket((current) => ({
                ...current,
                structuredIntake: { ...current.structuredIntake, patientAlias: value },
              }))
            }
            placeholder="Initials or alias"
          />
          <Field
            label="Age band"
            value={packet.structuredIntake.ageBand}
            onChangeText={(value) =>
              updatePacket((current) => ({
                ...current,
                structuredIntake: { ...current.structuredIntake, ageBand: value },
              }))
            }
            placeholder="Adult, older adult, teenager"
          />
          <Field
            label="Chief complaint"
            value={packet.structuredIntake.chiefComplaint}
            onChangeText={(value) =>
              updatePacket((current) => ({
                ...current,
                structuredIntake: { ...current.structuredIntake, chiefComplaint: value },
              }))
            }
            placeholder="Shortness of breath, chest pain, psych distress…"
          />
          <Field
            label="Urgency"
            value={packet.structuredIntake.urgencyLevel}
            onChangeText={(value) =>
              updatePacket((current) => ({
                ...current,
                structuredIntake: { ...current.structuredIntake, urgencyLevel: value },
              }))
            }
            placeholder="Immediate, urgent, stable but needs review"
          />
          <Field
            label="Transport mode"
            value={packet.structuredIntake.transportMode}
            onChangeText={(value) =>
              updatePacket((current) => ({
                ...current,
                structuredIntake: { ...current.structuredIntake, transportMode: value },
              }))
            }
            placeholder="Ambulance, clinic referral, ward consult"
          />
          <Field
            label="Red flags"
            value={packet.structuredIntake.redFlags}
            onChangeText={(value) =>
              updatePacket((current) => ({
                ...current,
                structuredIntake: { ...current.structuredIntake, redFlags: value },
              }))
            }
            placeholder="Airway concern, falling SpO2, agitation…"
            multiline
          />
          <Field
            label="Interventions completed"
            value={packet.structuredIntake.interventions}
            onChangeText={(value) =>
              updatePacket((current) => ({
                ...current,
                structuredIntake: { ...current.structuredIntake, interventions: value },
              }))
            }
            placeholder="Oxygen, positioning, transport prep, calming strategy"
            multiline
          />
          <Field
            label="Medications and allergies"
            value={`${packet.structuredIntake.medications}\n${packet.structuredIntake.allergies}`}
            onChangeText={(value) => {
              const [medications, ...rest] = value.split("\n");
              updatePacket((current) => ({
                ...current,
                structuredIntake: {
                  ...current.structuredIntake,
                  medications,
                  allergies: rest.join("\n"),
                },
              }));
            }}
            placeholder="Medications on first line, allergies below"
            multiline
          />
          <Field
            label="Behavioral-health context"
            value={packet.structuredIntake.mentalHealthContext}
            onChangeText={(value) =>
              updatePacket((current) => ({
                ...current,
                structuredIntake: { ...current.structuredIntake, mentalHealthContext: value },
              }))
            }
            placeholder="Observed behavior, triggers, de-escalation attempts"
            multiline
          />
          <Field
            label="Scene notes"
            value={packet.structuredIntake.notes}
            onChangeText={(value) =>
              updatePacket((current) => ({
                ...current,
                structuredIntake: { ...current.structuredIntake, notes: value },
              }))
            }
            placeholder="Anything the next clinician should know"
            multiline
          />
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Attachments</Text>
          <View style={styles.row}>
            <Pressable
              onPress={() => void handlePickDocument("camera")}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Take photo</Text>
            </Pressable>
            <Pressable
              onPress={() => void handlePickDocument("library")}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Choose from library</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => void handleToggleRecording()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>
              {recorderState.isRecording ? "Stop voice note" : "Record voice note"}
            </Text>
          </Pressable>
          <Text style={styles.helperText}>
            {recorderState.isRecording ? "Recording in progress…" : "Attach paperwork and one voice note."}
          </Text>
          <View style={styles.attachmentList}>
            {packet.attachments.length === 0 ? (
              <Text style={styles.helperText}>No attachments yet.</Text>
            ) : (
              packet.attachments.map((attachment) => (
                <View key={attachment.id} style={styles.attachmentRow}>
                  <Text style={styles.attachmentName}>{attachmentLabel(attachment)}</Text>
                  <Text style={styles.attachmentMeta}>{attachment.localUri.split("/").pop()}</Text>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Actions</Text>
          <Text style={styles.helperText}>{busyLabel || NON_DIAGNOSTIC_DISCLAIMER}</Text>
          <View style={styles.row}>
            <Pressable onPress={() => void handleSaveLocal()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Save locally</Text>
            </Pressable>
            <Pressable onPress={() => void handleSubmit()} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Submit to peer</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Peer analysis</Text>
          {activeJob ? (
            <>
              <Text style={styles.helperText}>
                {activeJob.status.toUpperCase()} · {activeJob.casePacketId.slice(0, 8)}
              </Text>
              <Text style={styles.summaryHeading}>Overview</Text>
              <Text style={styles.summaryText}>
                {activeJob.summary?.overview ?? "Waiting for summary…"}
              </Text>
              <Text style={styles.summaryHeading}>Protocol-grounded answer</Text>
              <Text style={styles.summaryText}>
                {activeJob.groundedAnswers[0]?.answer ?? "Waiting for grounded Q&A…"}
              </Text>
              <Field
                label="Ask a follow-up"
                value={question}
                onChangeText={setQuestion}
                placeholder={currentPreset.followUpPrompts[0]}
                multiline
              />
              <Pressable onPress={() => void handleAskQuestion()} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Ask grounded question</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.helperText}>No peer analysis job yet.</Text>
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Saved on device</Text>
          {savedPackets.length === 0 ? (
            <Text style={styles.helperText}>No saved cases yet.</Text>
          ) : (
            savedPackets.slice(0, 5).map((saved) => (
              <Pressable
                key={saved.id}
                onPress={() => setPacket(saved)}
                style={styles.savedCard}
              >
                <Text style={styles.savedCardTitle}>
                  {getScenarioPreset(saved.presetId).label} · {saved.status}
                </Text>
                <Text style={styles.savedCardMeta}>
                  {saved.structuredIntake.chiefComplaint || "No complaint yet"}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8a99b5"
        style={[styles.input, multiline && styles.textArea]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#09111f",
  },
  scrollBody: {
    padding: 16,
    gap: 14,
  },
  heroCard: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: "#0f1c33",
    borderWidth: 1,
    borderColor: "#1e3359",
    gap: 10,
  },
  eyebrow: {
    color: "#8eb0ff",
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    color: "#f3f7ff",
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "700",
  },
  lede: {
    color: "#c2d3f3",
    fontSize: 15,
    lineHeight: 22,
  },
  panel: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: "#0d172a",
    borderWidth: 1,
    borderColor: "#1b2a46",
    gap: 12,
  },
  sectionTitle: {
    color: "#f3f7ff",
    fontSize: 18,
    fontWeight: "700",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2a416d",
    backgroundColor: "#101d35",
  },
  chipActive: {
    backgroundColor: "#2c67ff",
    borderColor: "#2c67ff",
  },
  chipText: {
    color: "#c2d3f3",
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#ffffff",
  },
  helperText: {
    color: "#aab9d8",
    fontSize: 14,
    lineHeight: 20,
  },
  field: {
    gap: 8,
  },
  label: {
    color: "#dbe6fb",
    fontWeight: "600",
    fontSize: 14,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2a416d",
    backgroundColor: "#101d35",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f5f8ff",
    fontSize: 15,
  },
  textArea: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  row: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryButton: {
    flex: 1,
    minWidth: 150,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: "#2d67ff",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  secondaryButton: {
    flex: 1,
    minWidth: 150,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#2a416d",
    backgroundColor: "#101d35",
  },
  secondaryButtonText: {
    color: "#dbe6fb",
    fontWeight: "700",
  },
  attachmentList: {
    gap: 8,
  },
  attachmentRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#203357",
    backgroundColor: "#0f1b30",
    padding: 12,
    gap: 4,
  },
  attachmentName: {
    color: "#f5f8ff",
    fontWeight: "600",
  },
  attachmentMeta: {
    color: "#8ea8d7",
    fontSize: 13,
  },
  summaryHeading: {
    color: "#dbe6fb",
    fontWeight: "700",
    marginTop: 4,
  },
  summaryText: {
    color: "#c2d3f3",
    lineHeight: 21,
  },
  savedCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#203357",
    backgroundColor: "#0f1b30",
    padding: 12,
    gap: 4,
  },
  savedCardTitle: {
    color: "#f4f7ff",
    fontWeight: "700",
  },
  savedCardMeta: {
    color: "#96aacd",
  },
});

export default App;
