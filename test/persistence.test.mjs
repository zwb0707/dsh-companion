// persistence.test.mjs —— 状态真的落盘：心情重载、限速窗口过期、示例配置可用
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMood } from '../src/core/mood.mjs';
import { createGateway } from '../src/gateway/index.mjs';
import { openDb, memoryApi } from '../src/store.mjs';
import { resolveHome, ensureHome } from '../src/home.mjs';

const tmpHome = () => ensureHome(resolveHome({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-moxi-persist-')) }), {});

test('心情：写盘后新实例能读回来', () => {
  const dirs = tmpHome();
  const first = createMood({ dirs });
  first.onUserMessage();
  const snapshot = first.state();

  const second = createMood({ dirs });
  const reloaded = second.state();
  assert.equal(Math.round(reloaded.warmth), Math.round(snapshot.warmth));
  assert.equal(Math.round(reloaded.longing), Math.round(snapshot.longing));
});

test('限速窗口：过一分钟就恢复', async () => {
  const dirs = tmpHome();
  const db = openDb(dirs);
  const memory = memoryApi(db);
  let clock = 1_800_000_000_000;
  const transport = { async httpCall() { return { ok: true, data: { message_id: 1 } }; }, connect() { return { close() {} }; } };
  const config = {
    access: { allow: { private: ['10001'], groups: [] } },
    send: { maxSendPerMinute: 2, maxSendPerHour: 100, intervalMinMs: 1, intervalMaxMs: 1 },
    gateway: { enabled: true },
  };
  const gateway = createGateway({ config, dirs, memory, log: () => {}, now: () => clock, transport });

  await gateway.call('send', { key: 'private:10001', text: 'a' });
  await gateway.call('send', { key: 'private:10001', text: 'b' });
  await assert.rejects(() => gateway.call('send', { key: 'private:10001', text: 'c' }), /限速/);

  clock += 61_000;
  const after = await gateway.call('send', { key: 'private:10001', text: 'd' });
  assert.equal(after.result.ok, true, '一分钟窗口过去后应恢复发送');
  db.close();
});

test('发送失败三次后，等半小时窗口过去能恢复', async () => {
  const dirs = tmpHome();
  const db = openDb(dirs);
  const memory = memoryApi(db);
  let clock = 1_800_000_000_000;
  let fail = true;
  const transport = { async httpCall() { return fail ? { ok: false, error: 'boom' } : { ok: true, data: { message_id: 2 } }; }, connect() { return { close() {} }; } };
  const config = { access: { allow: { private: ['10001'], groups: [] } }, send: { maxSendPerMinute: 100, maxSendPerHour: 1000 }, gateway: { enabled: true } };
  const gateway = createGateway({ config, dirs, memory, log: () => {}, now: () => clock, transport });

  for (let i = 0; i < 3; i++) await assert.rejects(() => gateway.call('send', { key: 'private:10001', text: 'x' }));
  await assert.rejects(() => gateway.call('send', { key: 'private:10001', text: 'y' }), /暂停/);

  clock += 31 * 60_000;
  fail = false;
  const out = await gateway.call('send', { key: 'private:10001', text: 'z' });
  assert.equal(out.result.ok, true, '暂停窗口过去后应恢复');
  db.close();
});

test('示例配置能解析且字段对得上默认值', () => {
  const example = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'moxi.config.example.json'), 'utf8'));
  for (const key of ['gateway', 'access', 'send', 'history', 'mood', 'wakeBudget', 'purpose', 'agent', 'tools', 'turnGuard']) {
    assert.ok(key in example, '示例配置缺 ' + key);
  }
  assert.equal(example.gateway.enabled, false);
  assert.ok(Array.isArray(example.access.allow.private));
  assert.ok(example.purpose.tickMs >= 60000);
});
