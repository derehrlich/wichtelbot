// Datenbank: SQLite-Datei (in Node eingebaut, keine zusätzlichen Pakete).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,          -- 1 = nimmt an der Auslosung teil
  wishes TEXT NOT NULL DEFAULT '',
  no_gos TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL DEFAULT '',
  wishes_updated_at TEXT,                      -- ISO-Zeit, leer = noch nie eingetragen
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_tokens (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
-- Paare, die sich nicht ziehen dürfen (gilt in beide Richtungen). Immer a < b gespeichert.
CREATE TABLE IF NOT EXISTS exclusions (
  a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  drawn_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assignments (
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  giver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,                  -- geheimer Link-Teil für die Wichtel-Seite
  PRIMARY KEY (round_id, giver_id)
);
-- Merkt sich, welche Erinnerung schon an wen rausging (damit nichts doppelt kommt).
CREATE TABLE IF NOT EXISTS mail_log (
  key TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (key, user_id)
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
