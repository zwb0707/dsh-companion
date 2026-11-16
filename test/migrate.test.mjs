// migrate.test.mjs —— 旧运行时数据搬迁脚本：只搬数据，不碰代码，列名取交集
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'import-from-runtime.mjs');

function makeOldRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'old-runtime-'));
  fs.mkdirSync(path.join(root, 'data', 'persona'), { recursive: true });
  const db = new DatabaseSync(path.join(root, 'data', 'memory.sqlite'));
  db.exec(`
    CREATE TABLE memory (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, content TEXT, source TEXT, weight REAL,
      hits INTEGER, external_key TEXT, created_at INTEGER, updated_at INTEGER, speaker TEXT, scope TEXT, evidence TEXT, pinned INTEGER);
    CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, peer TEXT, role TEXT, content TEXT, at INTEGER);
    CREATE TABLE commitments (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, created_at INTEGER, done_at INTEGER);
  `);
  db.prepare('INSERT INTO memory (kind, content, source, weight, hits, created_at, updated_at, speaker, scope, evidence, pinned) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('fact', '主人喜欢下雨天', 'qq', 1, 0, 1, 1, 'owner', 'private', '', 0);
  db.prepare('INSERT INTO memory (kind, content, source, weight, hits, created_at, updated_at, speaker, scope, evidence, pinned) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('feeling', '有点想他', 'self', 1, 0, 2, 2, 'self', 'private', '', 0);
  db.prepare('INSERT INTO turns (platform, peer, role, content, at) VALUES (?,?,?,?,?)').run('qq', 'private:10001', 'her', '今天也想你', 3);
  db.prepare('INSERT INTO commitments (text, created_at, done_at) VALUES (?,?,?)').run('陪他看一场电影', 4, null);
  db.close();
  fs.writeFileSync(path.join(root, 'data', 'persona', 'role-card.md'), '# 角色卡\n\n旧卡内容\n', 'utf8');
  fs.writeFileSync(path.join(root, 'data', 'persona', 'role-card.md.bak-123'), '旧备份，不该搬', 'utf8');
  fs.writeFileSync(path.join(root, 'data', 'mode.json'), JSON.stringify({ mode: 'full', silent: false }), 'utf8');
  return root;
}

test('搬迁脚本：表行数、人格卡、config 都到位，备份文件不搬', () => {
  const from = makeOldRuntime();
  const to = fs.mkdtempSync(path.join(os.tmpdir(), 'new-home-'));
  execFileSync(process.execPath, [SCRIPT, '--from', from, '--to', to], { encoding: 'utf8' });

  const db = new DatabaseSync(path.join(to, 'data', 'memory.sqlite'), { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM turns').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM commitments').get().n, 1);
  assert.equal(db.prepare("SELECT content FROM memory WHERE kind='feeling'").get().content, '有点想他');
  db.close();

  assert.ok(fs.existsSync(path.join(to, 'data', 'persona', 'role-card.md')));
  assert.match(fs.readFileSync(path.join(to, 'data', 'persona', 'role-card.md'), 'utf8'), /旧卡内容/);
  assert.ok(!fs.existsSync(path.join(to, 'data', 'persona', 'role-card.md.bak-123')), '不该搬备份');
  assert.ok(fs.existsSync(path.join(to, 'data', 'mode.json')));
});

test('--dry 不动目标目录', () => {
  const from = makeOldRuntime();
  const to = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-home-'));
  const out = execFileSync(process.execPath, [SCRIPT, '--from', from, '--to', to, '--dry'], { encoding: 'utf8' });
  assert.match(out, /"dry": true/);
  assert.ok(!fs.existsSync(path.join(to, 'data', 'memory.sqlite')), 'dry 模式不该建库');
});

test('缺参数时用法报错', () => {
  assert.throws(() => execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: 'pipe' }), /命令失败|Command failed/);
});
