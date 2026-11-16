// agent.test.mjs —— 5 个大脑动作：演练（假 llm）/ 日报 / 目的素材 / 唤醒 / 收尾
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAgentService } from '../src/agent/service.mjs';
import { openDb, memoryApi } from '../src/store.mjs';
import { createMood } from '../src/core/mood.mjs';
import { resolveHome, ensureHome } from '../src/home.mjs';

function setup({ withLlm = true, reply = '哼，才没有在等你呢' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-moxi-agent-'));
  const dirs = ensureHome(resolveHome({ home }), {});
  fs.writeFileSync(path.join(dirs.persona, 'role-card.md'), '# 角色卡\n\n你是一只软软的小鲸鱼。\n', 'utf8');
  const db = openDb(dirs);
  const memory = memoryApi(db);
  const mood = createMood({ dirs });
  const calls = [];
  const llm = withLlm ? {
    async *stream(options) {
      calls.push(options);
      yield { type: 'text-delta', index: 0, text: reply.slice(0, 4) };
      yield { type: 'text-delta', index: 0, text: reply.slice(4) };
      yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  } : null;
  const service = createAgentService({ dirs, config: { provider: 'p', model: 'm', history: { limit: 5 } }, db, memory, mood, llm, log: () => {}, now: () => Date.now() });
  return { home, dirs, db, memory, mood, service, calls };
}

test('simulate：走 llm.stream 但不发送，并把用量记账', async () => {
  const { service, calls, memory } = setup();
  assert.equal(service.available, true);
  const out = await service.call('simulate', { text: '在干嘛', key: 'private:10001' });
  assert.equal(out.result.ok, true);
  assert.equal(out.result.dry, true);
  assert.equal(out.result.reply, '哼，才没有在等你呢');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].purpose, 'moxi-simulate');
  assert.ok(calls[0].system.includes('小鲸鱼'), '系统提示应带人格卡');
  assert.equal(out.result.usage.inputTokens, 120);
  const usage = memory.recentTurns({ limit: 5 });
  assert.equal(usage.length, 0, '演练不写流水');
});

test('simulate：没有 llm 时如实报 not-connected', async () => {
  const { service } = setup({ withLlm: false });
  assert.equal(service.available, false);
  const out = await service.call('simulate', { text: '在吗' });
  assert.equal(out.result.ok, false);
  assert.equal(out.result.code, 'not-connected');
  assert.equal(out.result.need, 'agent');
});

test('simulate：回复里的泄漏会被遮罩', async () => {
  const { service } = setup({ reply: '看 D:\\her\\data 里的 127.0.0.1:3155 就知道' });
  const out = await service.call('simulate', { text: 'x' });
  assert.ok(!out.result.reply.includes('D:\\her'));
  assert.ok(!out.result.reply.includes('127.0.0.1:3155'));
  assert.ok(out.result.maskedLeaks.length >= 2);
});

test('report：本地生成 markdown 并落盘', async () => {
  const { service, memory, dirs } = setup();
  memory.add({ kind: 'fact', content: '主人喜欢下雨天', source: 'self' });
  memory.logTurn({ platform: 'qq', peer: 'private:10001', role: 'her', content: '今天也想你' });
  const out = await service.call('report', {});
  assert.equal(out.result.ok, true);
  assert.match(out.result.markdown, /日报/);
  assert.match(out.result.markdown, /心情/);
  assert.match(out.result.markdown, /主人喜欢下雨天/);
  assert.ok(fs.existsSync(out.result.path));
  assert.ok(out.result.path.startsWith(dirs.data), '日报应落在 home/data 下');
});

test('purposeMaterials：空库给提示，有记忆后给素材', async () => {
  const { service, memory } = setup();
  const empty = await service.call('purposeMaterials', {});
  assert.equal(empty.result.items.length, 0);
  memory.add({ kind: 'pending', content: '想问问他今天忙不忙', source: 'self' });
  const filled = await service.call('purposeMaterials', { limit: 3 });
  assert.equal(filled.result.items.length, 1);
  assert.match(filled.result.items[0].statement, /今天忙不忙/);
});

test('wake / close：状态落盘，收尾会写一条记忆', async () => {
  const { service, dirs, memory } = setup();
  const saved = await service.call('wake', { key: 'private:10001', config: { probability: 0.3 } });
  assert.equal(saved.result.saved.probability, 0.3);
  const wakeFile = path.join(dirs.state, 'wake.json');
  assert.ok(fs.existsSync(wakeFile));

  const closed = await service.call('close', { key: 'private:10001', summary: '聊到今天很累', nextOpening: '问问他睡没睡' });
  assert.equal(closed.result.ok, true);
  const stored = JSON.parse(fs.readFileSync(path.join(dirs.state, 'closure.json'), 'utf8'));
  assert.equal(stored['private:10001'].summary, '聊到今天很累');
  assert.equal(memory.query({ query: '聊到' }).total, 1);
});
