// integration.test.mjs —— 一次完整流程：装插件 → 演练 → 主动开口 → 日报 → 记忆查询
//
// 全部用假服务（llm / gateway / douyin），不连 QQ、不连抖音、不碰真模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { apply } = await import('../index.mjs');

function fakeCtx() {
  const tools = [];
  const provided = {};
  const external = {};
  const timers = [];
  const ctx = {
    tools: { register(def) { tools.push(def); return () => { const i = tools.indexOf(def); if (i >= 0) tools.splice(i, 1); }; } },
    effect(fn) { const dispose = fn(); return () => { try { dispose?.(); } catch { /* 忽略 */ } }; },
    provide(name) { provided[name] = true; },
    get(name) { return external[name]; },
    timer: { interval(cb, ms) { timers.push({ cb, ms }); return () => {}; } },
    logger: { info() {}, warn() {}, error() {} },
  };
  return { ctx, tools, provided, external, timers };
}

test('端到端：演练 → 主动开口 → 日报 都跑得通', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-moxi-e2e-'));
  const { ctx, tools, provided, external, timers } = fakeCtx();

  const llmCalls = [];
  ctx.agentDefaultModel = { currentSelection: () => ({ provider: 'fake', model: 'fake-1' }) };
  ctx.llm = {
    async *stream(options) {
      llmCalls.push(options);
      yield { type: 'text-delta', index: 0, text: '我在呢，' };
      yield { type: 'text-delta', index: 0, text: '刚刚还想着你' };
      yield { type: 'usage', usage: { inputTokens: 80, outputTokens: 8 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  const sent = [];
  const gateway = { async call(action, params) { sent.push({ action, params }); return { tool: 'moxi_send', result: { ok: true, messageId: 7 } }; } };
  external.moxiDouyin = { async call(action, params) { return { tool: 'moxi_' + action, result: { ok: true, params }, imageStatus: '' }; } };

  await apply(ctx, {
    home,
    access: { allow: { private: ['10001'], groups: [] } },
    gateway: { enabled: true, baseUrl: 'http://fake', wsUrl: 'ws://fake' },
    purpose: { enabled: true, dailyMax: 2, gapMinMs: 0, gapMaxMs: 0, tickMs: 60000 },
  }, { gateway });
  const service = ctx.moxi;   // apply 不返回值（Cordis 把返回值当 disposer），服务挂在 ctx 上

  assert.ok(provided.moxi, '插件应暴露 moxi 服务');
  assert.equal(tools.length, 51);
  assert.ok(timers.length >= 1, '主动开口应挂上定时器');
  assert.equal(service.services.gateway, gateway);

  const call = (name, args) => tools.find((t) => t.name === name).execute(args ?? {});

  // 1) 演练：走 llm，不发送
  const sim = await call('moxi_simulate', { text: '在干嘛', key: 'private:10001' });
  assert.equal(sim.result.ok, true);
  assert.equal(sim.result.reply, '我在呢，刚刚还想着你');
  assert.equal(sent.length, 0, '演练不该真的发送');

  // 2) 主动开口：真的发一条，并写记忆
  const tick = await service.purpose.tick();
  assert.equal(tick.spoken, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params.key, 'private:10001');

  // 3) 状态里能看到心情与主动开口的判断
  const status = await call('moxi_status');
  assert.equal(status.result.ok, true);
  assert.ok(status.result.mood.text.length > 0);
  assert.equal(status.result.purpose.enabled, true, '主动开口已启用');
  assert.equal(status.result.purpose.target, 'private:10001');
  assert.equal(typeof status.result.purpose.verdict.ok, 'boolean');

  // 4) 抖音入口：有服务就转发
  const dy = await call('moxi_douyin', { plugin: true });
  assert.equal(dy.result.ok, true);

  // 5) 日报：本地生成，含刚才的记忆
  const report = await call('moxi_report');
  assert.equal(report.result.ok, true);
  assert.match(report.result.markdown, /日报/);

  // 6) 记忆里应有主动开口那条
  const mem = await call('moxi_memory', { op: 'query', query: '主动找他说' });
  assert.equal(mem.result.total, 1);
});
