import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import {
  NON_DIAGNOSTIC_DISCLAIMER,
  type AnalysisJob,
  type PairingSession,
  type RuntimeStatus,
} from "@medmesh/shared";

import "./App.css";

interface HealthPayload {
  app: string;
  ok: boolean;
  disclaimer: string;
  pairing: PairingSession;
  runtime: RuntimeStatus;
  jobCount: number;
  artifactPaths: RuntimeStatus["artifactPaths"];
}

function formatTime(value?: string): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString();
}

function getModelBadgeClass(status: RuntimeStatus["models"][number]["status"]): string {
  if (status === "loaded") {
    return "badge live";
  }

  if (status === "failed") {
    return "badge failed";
  }

  return "badge idle";
}

function App() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [healthResponse, jobsResponse] = await Promise.all([
          fetch("/health"),
          fetch("/api/jobs"),
        ]);
        const [healthPayload, jobsPayload] = await Promise.all([
          healthResponse.json() as Promise<HealthPayload>,
          jobsResponse.json() as Promise<AnalysisJob[]>,
        ]);
        if (cancelled) {
          return;
        }

        setHealth(healthPayload);
        setJobs(jobsPayload);
        setSelectedJobId((current) => current || jobsPayload[0]?.id || "");
        setError("");
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load peer-core data.",
          );
        }
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? jobs[0],
    [jobs, selectedJobId],
  );

  return (
    <main className="shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">MedMesh Peer Console</p>
          <h1>Nearby compute for offline clinical handoff</h1>
          <p className="lede">
            This console shows pairing state, requested versus effective QVAC
            runtime, evidence outputs, and every case job flowing in from the
            field capture app.
          </p>
        </div>
        <div className="hero-stat-grid">
          <div className="stat-card">
            <span>Effective runtime</span>
            <strong>{health?.runtime.effectiveMode ?? "loading"}</strong>
          </div>
          <div className="stat-card">
            <span>Requested mode</span>
            <strong>{health?.runtime.requestedMode ?? "—"}</strong>
          </div>
          <div className="stat-card">
            <span>Jobs seen</span>
            <strong>{health?.jobCount ?? 0}</strong>
          </div>
          <div className="stat-card">
            <span>Health</span>
            <strong>{health?.runtime.health ?? "—"}</strong>
          </div>
        </div>
      </section>

      {error ? <div className="alert">{error}</div> : null}
      {health?.runtime.liveInitError ? (
        <div className="alert">
          Live init degraded to mock: {health.runtime.liveInitError}
        </div>
      ) : null}

      <section className="grid">
        <article className="panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Pairing</p>
              <h2>Field device onboarding</h2>
            </div>
          </header>
          {health?.pairing ? (
            <div className="pairing-grid">
              <div className="qr-block">
                <QRCodeSVG
                  value={health.pairing.qrValue}
                  size={160}
                  bgColor="transparent"
                  fgColor="#f4f7fb"
                  includeMargin
                />
              </div>
              <div className="pairing-meta">
                <div>
                  <span className="label">Code</span>
                  <strong>{health.pairing.code}</strong>
                </div>
                <div>
                  <span className="label">Base URL</span>
                  <code>{health.pairing.baseUrl}</code>
                </div>
                <div>
                  <span className="label">Provider key</span>
                  <code>{health.pairing.providerPublicKey || "mock provider"}</code>
                </div>
                <div>
                  <span className="label">Evidence dir</span>
                  <code>{health.artifactPaths.evidenceDir}</code>
                </div>
              </div>
            </div>
          ) : (
            <p>Waiting for peer-core pairing session…</p>
          )}
        </article>

        <article className="panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Models</p>
              <h2>QVAC runtime</h2>
            </div>
          </header>
          <div className="model-list">
            <div className="model-row">
              <div>
                <strong>{health?.runtime.hardware.deviceLabel ?? "Peer hardware"}</strong>
                <p>
                  {health?.runtime.hardware.cpuModel ?? "Unknown CPU"} ·{" "}
                  {health?.runtime.hardware.cpuCores ?? 0} cores ·{" "}
                  {health?.runtime.hardware.totalMemoryGb ?? 0} GB RAM
                </p>
              </div>
              <span className="badge idle">
                {health?.runtime.hardware.gpuLabel ?? "GPU env optional"}
              </span>
            </div>
            {health?.runtime.models.map((model) => (
              <div className="model-row" key={model.name}>
                <div>
                  <strong>{model.name}</strong>
                  <p>{model.source || "Env var not set yet"}</p>
                  {model.error ? <p>{model.error}</p> : null}
                </div>
                <span className={getModelBadgeClass(model.status)}>
                  {model.status}
                </span>
              </div>
            )) ?? <p>No model status yet.</p>}
          </div>
        </article>
      </section>

      <section className="grid">
        <article className="panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Jobs</p>
              <h2>Recent case packets</h2>
            </div>
          </header>
          <div className="job-list">
            {jobs.length === 0 ? (
              <p className="empty-state">No case packets yet. Submit one from the mobile app.</p>
            ) : (
              jobs.map((job) => (
                <button
                  key={job.id}
                  className={`job-card ${selectedJob?.id === job.id ? "selected" : ""}`}
                  onClick={() => setSelectedJobId(job.id)}
                  type="button"
                >
                  <div className="job-topline">
                    <strong>{job.casePacketId.slice(0, 8)}</strong>
                    <span className={`badge ${job.status}`}>{job.status}</span>
                  </div>
                  <p>Updated {formatTime(job.updatedAt)}</p>
                  <div className="stage-strip">
                    {job.stages.map((stage) => (
                      <span key={stage.name} className={`stage-pill ${stage.state}`}>
                        {stage.name}
                      </span>
                    ))}
                  </div>
                </button>
              ))
            )}
          </div>
        </article>

        <article className="panel detail-panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Selected job</p>
              <h2>Judge-facing handoff artifact</h2>
            </div>
            {selectedJob?.exportPath ? (
              <a className="ghost-link" href={`/api/jobs/${selectedJob.id}/export`} target="_blank">
                Export markdown
              </a>
            ) : null}
          </header>

          {!selectedJob ? (
            <p className="empty-state">Pick a job to inspect its summary, timings, and grounded answers.</p>
          ) : (
            <div className="detail-grid">
              <div className="detail-card">
                <span className="label">Created</span>
                <strong>{formatTime(selectedJob.createdAt)}</strong>
              </div>
              <div className="detail-card">
                <span className="label">Pairing code</span>
                <strong>{selectedJob.pairingCode}</strong>
              </div>
              <div className="detail-card wide">
                <span className="label">Overview</span>
                <p>{selectedJob.summary?.overview ?? "Summary pending…"}</p>
              </div>
              <div className="detail-card wide">
                <span className="label">Situation</span>
                <p>{selectedJob.summary?.presentingSituation ?? "Situation pending…"}</p>
              </div>
              <div className="detail-card wide">
                <span className="label">Key findings</span>
                <ul>
                  {(selectedJob.summary?.keyFindings ?? []).map((finding) => (
                    <li key={finding}>{finding}</li>
                  ))}
                </ul>
              </div>
              <div className="detail-card wide">
                <span className="label">Grounded Q&A</span>
                <ul>
                  {selectedJob.groundedAnswers.length === 0 ? (
                    <li>No grounded answer yet.</li>
                  ) : (
                    selectedJob.groundedAnswers.map((answer) => (
                      <li key={`${answer.question}-${answer.answer}`}>
                        <strong>{answer.question}</strong>
                        <p>{answer.answer}</p>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          )}
        </article>
      </section>

      <footer className="footer-note">{health?.disclaimer ?? NON_DIAGNOSTIC_DISCLAIMER}</footer>
    </main>
  );
}

export default App;
