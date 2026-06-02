import fs from "node:fs";
import path from "node:path";

import type { PairingSession, RuntimeStatus } from "@medmesh/shared";

export function ensurePairingSession(
  dataDir: string,
  baseUrl: string,
  runtime: RuntimeStatus,
): PairingSession {
  const pairingPath = path.join(dataDir, "pairing-session.json");
  fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(pairingPath)) {
    return JSON.parse(fs.readFileSync(pairingPath, "utf8")) as PairingSession;
  }

  const generatedAt = new Date().toISOString();
  const session: PairingSession = {
    code: Math.random().toString(36).slice(2, 8).toUpperCase(),
    topic: runtime.providerTopic,
    providerPublicKey:
      runtime.providerPublicKey || "mock-provider-public-key-medmesh",
    providerMode: runtime.mode,
    baseUrl,
    generatedAt,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    qrValue: "",
  };

  session.qrValue = JSON.stringify({
    code: session.code,
    baseUrl: session.baseUrl,
    topic: session.topic,
    providerPublicKey: session.providerPublicKey,
  });

  fs.writeFileSync(pairingPath, JSON.stringify(session, null, 2), "utf8");
  return session;
}
