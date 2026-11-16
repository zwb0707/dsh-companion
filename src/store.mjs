// store.mjs —— 本地存储：一个 sqlite（记忆/流水/约定/黑话/经验）+ 若干 JSON 状态文件
//
// 与旧运行时的表结构保持兼容（memory/turns/commitments/slang/experience/observations/usage），
// 迁移旧库时直接放进去就能读。

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'self',
  weight REAL NOT NULL DEFAULT 1,
  hits INTEGER NOT NULL DEFAULT 0,
  external_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  speaker TEXT NOT NULL DEFAULT 'unknown',
  scope TEXT NOT NULL DEFAULT 'private',
  evidence TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory(kind);
CREATE INDEX IF NOT EXISTS idx_memory_created ON memory(created_at DESC);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  peer TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_peer ON turns(peer, at DESC);
CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE TABLE IF NOT EXISTS slang (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL UNIQUE,
  meaning TEXT NOT NULL DEFAULT '',
  usage TEXT NOT NULL DEFAULT '',
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS experience (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  delta REAL NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  proactive INTEGER NOT NULL DEFAULT 0,
  background INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE(day)
);
`;

export function openDb(dirs) {
  fs.mkdirSync(path.dirname(dirs.db), { recursive: true });
  const db = new DatabaseSync(dirs.db);
  db.exec(SCHEMA);
  return db;
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

export function appendJsonl(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}

export function readJsonlTail(file, limit = 50) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  } catch { return []; }
}

/** 记忆查询/写入的最小实现（不含向量化，保持可移植） */
export function memoryApi(db, now = Date.now) {
  const insert = db.prepare(`INSERT INTO memory (kind, content, source, weight, external_key, created_at, updated_at, speaker, scope, evidence, pinned)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  return {
    add({ kind = 'fact', content, source = 'self', weight = 1, speaker = 'self', scope = 'private', evidence = '', externalKey = null, pinned = false }) {
      if (!content || String(content).trim().length < 2) throw new Error('内容太短');
      const ts = now();
      const info = insert.run(kind, String(content), source, weight, externalKey, ts, ts, speaker, scope, evidence, pinned ? 1 : 0);
      return { id: Number(info.lastInsertRowid) };
    },
    query({ query = '', kind = '', limit = 20, offset = 0, pinned } = {}) {
      const where = [];
      const args = [];
      if (query) { where.push('content LIKE ?'); args.push(`%${query}%`); }
      if (kind) { where.push('kind = ?'); args.push(kind); }
      if (typeof pinned === 'boolean') { where.push('pinned = ?'); args.push(pinned ? 1 : 0); }
      const sql = `SELECT id, kind, content, source, speaker, scope, pinned, created_at FROM memory ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const rows = db.prepare(sql).all(...args, Math.min(200, Math.max(1, Number(limit) || 20)), Math.max(0, Number(offset) || 0));
      const total = db.prepare(`SELECT count(*) AS n FROM memory ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...args).n;
      return { total, items: rows.map((r) => ({ ...r, pinned: Boolean(r.pinned) })) };
    },
    update({ id, content, pinned }) {
      const row = db.prepare('SELECT id FROM memory WHERE id = ?').get(Number(id));
      if (!row) throw new Error('没有这条记忆：' + id);
      if (typeof content === 'string' && content.trim()) db.prepare('UPDATE memory SET content = ?, updated_at = ? WHERE id = ?').run(content.trim(), now(), Number(id));
      if (typeof pinned === 'boolean') db.prepare('UPDATE memory SET pinned = ?, updated_at = ? WHERE id = ?').run(pinned ? 1 : 0, now(), Number(id));
      return { id: Number(id) };
    },
    delete({ id }) {
      const info = db.prepare('DELETE FROM memory WHERE id = ?').run(Number(id));
      return { deleted: info.changes };
    },
    stats() {
      const total = db.prepare('SELECT count(*) AS n FROM memory').get().n;
      const byKind = db.prepare('SELECT kind, count(*) AS n FROM memory GROUP BY kind').all();
      return { total, byKind };
    },
    logTurn({ platform = 'qq', peer, role, content, at = now() }) {
      db.prepare('INSERT INTO turns (platform, peer, role, content, at) VALUES (?,?,?,?,?)').run(platform, String(peer), role, String(content), at);
    },
    recentTurns({ platform = 'qq', peer, limit = 20 } = {}) {
      const args = [];
      const where = [];
      if (platform) { where.push('platform = ?'); args.push(platform); }
      if (peer) { where.push('peer = ?'); args.push(peer); }
      return db.prepare(`SELECT role, content, at FROM turns ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC LIMIT ?`)
        .all(...args, Math.min(200, Math.max(1, Number(limit) || 20))).reverse();
    },
  };
}
