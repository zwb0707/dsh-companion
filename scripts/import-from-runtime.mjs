#!/usr/bin/env node
// import-from-runtime.mjs —— 把旧运行时的数据搬进插件的 home 目录
//
// 用法（两个目录都由参数给，脚本里没有任何绝对路径）：
//   node scripts/import-from-runtime.mjs --from <旧运行时根> --to <插件 home> [--dry]
//
// 搬什么：
//   <from>/data/memory.sqlite  → <to>/data/memory.sqlite  （逐表逐行，按列名取交集，重复行跳过）
//   <from>/data/persona/*.md   → <to>/data/persona/       （人格卡与分部件）
//   <from>/data/{mode,send-guard,wake-budget,stickers}.json → <to>/data/
//   <from>/state/{mode,proactive-pause,mood}.json → <to>/state/（存在才搬）
//
// 不搬：日志、会话归档、图片、抖音状态（那些属于旧部署，且体积大）。

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/store.mjs';   // 目标库按插件自己的 schema 建，避免"表不存在"

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const FROM = opt('from');
const TO = opt('to');
const DRY = args.includes('--dry');

if (!FROM || !TO) {
  console.error('用法: node scripts/import-from-runtime.mjs --from <旧运行时根> --to <插件 home> [--dry]');
  process.exit(2);
}
for (const dir of [FROM, TO]) {
  if (!fs.existsSync(dir)) { console.error('目录不存在：' + dir); process.exit(2); }
}

const report = { from: FROM, to: TO, dry: DRY, tables: {}, files: [], skipped: [] };
const TARGET_DB = path.join(TO, 'data', 'memory.sqlite');
const SOURCE_DB = path.join(FROM, 'data', 'memory.sqlite');

// ── 1) 数据库 ────────────────────────────────────────────────
function columns(db, table) {
  try { return db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name); } catch { return []; }
}

if (fs.existsSync(SOURCE_DB)) {
  if (!DRY) fs.mkdirSync(path.dirname(TARGET_DB), { recursive: true });
  const src = new DatabaseSync(SOURCE_DB, { readOnly: true });
  const dst = DRY ? null : openDb({ db: TARGET_DB });
  const tables = src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);

  for (const table of tables) {
    const srcCols = columns(src, table);
    const dstCols = dst ? columns(dst, table) : srcCols;
    const shared = srcCols.filter((c) => dstCols.includes(c));
    if (!shared.length) { report.skipped.push(`${table}: 无同名列`); continue; }
    let rows = 0;
    let inserted = 0;
    try {
      const all = src.prepare(`SELECT ${shared.map((c) => `"${c}"`).join(',')} FROM "${table}"`).all();
      rows = all.length;
      if (dst) {
        const sql = `INSERT INTO "${table}" (${shared.map((c) => `"${c}"`).join(',')}) VALUES (${shared.map(() => '?').join(',')})`;
        const stmt = dst.prepare(sql);
        for (const row of all) {
          try { stmt.run(...shared.map((c) => row[c])); inserted += 1; } catch { /* 主键冲突/约束不符：跳过这一行 */ }
        }
      }
    } catch (error) {
      report.skipped.push(`${table}: ${String(error?.message ?? error).slice(0, 80)}`);
    }
    report.tables[table] = { rows, inserted };
  }
  src.close();
  if (dst) { try { dst.exec('VACUUM'); } catch { /* 忽略 */ } dst.close(); }
} else {
  report.skipped.push('源目录没有 data/memory.sqlite');
}

// ── 2) 人格与状态文件 ────────────────────────────────────────
function copyFile(rel, destRel) {
  const from = path.join(FROM, rel);
  if (!fs.existsSync(from)) return;
  const to = path.join(TO, destRel);
  if (DRY) { report.files.push(rel + ' → ' + destRel + '（dry）'); return; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  report.files.push(rel + ' → ' + destRel);
}

const personaDir = path.join(FROM, 'data', 'persona');
if (fs.existsSync(personaDir)) {
  for (const name of fs.readdirSync(personaDir)) {
    if (!/\.md$/.test(name)) continue;   // 跳过 *.bak-* 和 state.json
    copyFile(path.join('data', 'persona', name), path.join('data', 'persona', name));
  }
}
for (const name of ['mode.json', 'send-guard.json', 'wake-budget.json', 'stickers.json', 'access.json']) {
  copyFile(path.join('data', name), path.join('data', name));
}
for (const name of ['mode.json', 'proactive-pause.json']) {
  if (fs.existsSync(path.join(FROM, 'data', name))) copyFile(path.join('data', name), path.join('state', name));
}

console.log(JSON.stringify(report, null, 2));
if (!DRY) {
  const total = Object.values(report.tables).reduce((a, t) => a + t.inserted, 0);
  console.log(`\n完成：导入 ${total} 行，文件 ${report.files.length} 个。下次启动插件就会读到它们。`);
}
