// purpose.test.mjs —— 主动开口：什么时候不该说、什么时候说、说完记什么
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPurposeLoop, inQuietHours } from '../src/purpose/loop.mjs';
import { openDb, memoryApi } from '../src/store.mjs';
import { createMood } from '../src/core/mood.mjs';
import { createWakeBudget } from '../src/core/guards.mjs';
import { resolveHome, ensureHome } from '../src/home.mjs';

function setup({ now = new Date('2026-11-16T14:00:00+08:00').getTime(), pauseUntil = 0, sentToday = 0, purposes = {} } = {}) {
  let clock = now;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-moxi-purpose-'));
  const dirs = ensureHome(resolveHome({ home }), {});
  const db = openDb(dirs);
  const memory = memoryApi(db);
  const mood = createMood({ dirs, now: () => clock });
  const sends = [];
  const gateway = { async call(action, params) { sends.push({ action, params }); return { tool: 'moxi_send', result: { ok: true, key: params.key, messageId: 1 } }; } };
  const agent = { available: true, async call(action, params) { return { tool: 'moxi_simulate', result: { ok: true, dry: true, reply: params.text.includes('主动') ? '在忙吗，我刚想到你' : '嗯' } }; } };
  const wakeBudget = createWakeBudget({ dirs, config: { privateMaxPerDay: 10, minGapMs: 0 }, now: () => clock });
  const config = { access: { allow: { private: ['10001'], groups: [] } }, purpose: { dailyMax: 3, gapMinMs: 0, gapMaxMs: 0, quietStart: '01:00', quietEnd: '06:00', ...purposes } };
  const loop = createPurposeLoop({ dirs, config, memory, mood, agent, gateway, pause: () => ({ until: pauseUntil }), wakeBudget, now: () => clock, log: () => {} });
  if (sentToday) fs.writeFileSync(path.join(dirs.state, 'purpose.json'), JSON.stringify({ day: new Date(clock).toISOString().slice(0, 10), sentToday, lastAt: 0, history: [] }), 'utf8');
  return { dirs, db, memory, loop, sends, wakeBudget, advance: (ms) => { clock += ms; } };
}

test('静默时段判断（含跨零点）', () => {
  assert.equal(inQuietHours(new Date('2026-11-16T02:00:00+08:00').getTime()), true);
  assert.equal(inQuietHours(new Date('2026-11-16T14:00:00+08:00').getTime()), false);
  assert.equal(inQuietHours(new Date('2026-11-16T23:30:00+08:00').getTime(), '22:00', '07:00'), true);
});

test('条件都满足时真的发一条，并记账', async () => {
  const { loop, sends, memory, dirs } = setup();
  const out = await loop.tick();
  assert.equal(out.spoken, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].params.text, '在忙吗，我刚想到你');
  assert.equal(memory.query({ query: '主动找他说' }).total, 1);
  const state = JSON.parse(fs.readFileSync(path.join(dirs.state, 'purpose.json'), 'utf8'));
  assert.equal(state.sentToday, 1);
});

test('暂停中不开口', async () => {
  const { loop, sends } = setup({ pauseUntil: Date.now() + 3600_000 });
  const out = await loop.tick();
  assert.equal(out.spoken, false);
  assert.match(out.reason, /暂停/);
  assert.equal(sends.length, 0);
});

test('静默时段不开口', async () => {
  const { loop, sends } = setup({ now: new Date('2026-11-16T03:00:00+08:00').getTime() });
  const out = await loop.tick();
  assert.equal(out.spoken, false);
  assert.match(out.reason, /静默/);
  assert.equal(sends.length, 0);
});

test('今日上限到了就不再说', async () => {
  const { loop, sends } = setup({ sentToday: 3 });
  const out = await loop.tick();
  assert.equal(out.spoken, false);
  assert.match(out.reason, /上限/);
  assert.equal(sends.length, 0);
});

test('间隔不够时给出下次时间', async () => {
  const { loop, sends, dirs } = setup({ purposes: { gapMinMs: 3600_000, gapMaxMs: 3600_000 } });
  await loop.tick();
  assert.equal(sends.length, 1);
  const second = await loop.tick();
  assert.equal(second.spoken, false);
  assert.match(second.reason, /不够久/);
  assert.ok(second.nextInMs > 0);
});

test('dry 模式只生成不发送', async () => {
  const { loop, sends } = setup();
  const out = await loop.tick({ dry: true });
  assert.equal(out.spoken, false);
  assert.equal(out.wouldSay, '在忙吗，我刚想到你');
  assert.equal(sends.length, 0);
});

test('没有网关/没有 llm 时如实说明', async () => {
  const { dirs, memory } = setup();
  const loopNoGw = createPurposeLoop({ dirs, config: { access: { allow: { private: ['10001'] } }, purpose: {} }, memory, now: Date.now, pause: () => ({ until: 0 }) });
  assert.match(loopNoGw.shouldSpeak().reason, /网关/);
  const loopNoLlm = createPurposeLoop({ dirs, config: { access: { allow: { private: ['10001'] } }, purpose: {} }, memory, now: Date.now, pause: () => ({ until: 0 }), gateway: { call: async () => ({}) } });
  assert.match(loopNoLlm.shouldSpeak().reason, /llm/);
});
