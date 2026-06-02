import * as SQLite from "expo-sqlite";

import type { CasePacket } from "@medmesh/shared";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync("medmesh.db");
  }

  return databasePromise;
}

export async function initCaseStore(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS case_packets (
      id TEXT PRIMARY KEY NOT NULL,
      preset_id TEXT NOT NULL,
      status TEXT NOT NULL,
      packet_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export async function saveCasePacket(packet: CasePacket): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO case_packets
      (id, preset_id, status, packet_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [
      packet.id,
      packet.presetId,
      packet.status,
      JSON.stringify(packet),
      packet.createdAt,
      packet.updatedAt,
    ],
  );
}

export async function listSavedCasePackets(): Promise<CasePacket[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ packet_json: string }>(
    "SELECT packet_json FROM case_packets ORDER BY updated_at DESC",
  );

  return rows.map((row) => JSON.parse(row.packet_json) as CasePacket);
}
