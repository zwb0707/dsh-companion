// douyin.test.mjs —— 抖音入口：有服务就转发，没有就如实报 not-connected
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
  const ctx = {
    tools: { register(def) { tools.push(def); return () => {}; } },
    effect(fn) { const dispose = fn(); return () => dispose?.(); },
    provide(name) { provided[name] = true; },
    get(name) { return external[name]; },
    logger: { info() {}, warn() {}, error() {} },
  };
  return { ctx, tools, provided, external };
}

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-moxi-dy-'));
const call = (tools, name, args) => tools.find((t) => t.name === name).execute(args ?? {});

test('没有抖音服务时，两个抖音动作都报 not-connected', async () => {
  const { ctx, tools } = fakeCtx();
  await apply(ctx, { home: home() });
  for (const tool of ['moxi_douyin', 'moxi_douyin_account']) {
    const out = await call(tools, tool, {});
    assert.equal(out.result.ok, false, tool);
    assert.equal(out.result.code, 'not-connected');
    assert.equal(out.result.need, 'douyin');
  }
  const health = await call(tools, 'moxi_health');
  const row = health.result.checks.find((c) => c.item === '抖音 bundle');
  assert.equal(row.ok, false);
});

test('抖音服务后注入也能被调用（懒查找）', async () => {
  const { ctx, tools, external } = fakeCtx();
  await apply(ctx, { home: home() });
  const seen = [];
  external.moxiDouyin = {
    async call(action, params) {
      seen.push({ action, params });
      return { tool: 'moxi_' + action, result: { ok: true, echoed: params }, images: [], imageStatus: '本次操作没有采集画面。' };
    },
  };

  const out = await call(tools, 'moxi_douyin', { plugin: true });
  assert.equal(out.result.ok, true);
  assert.equal(out.result.echoed.plugin, true);
  assert.deepEqual(seen[0], { action: 'douyin', params: { plugin: true } });

  const health = await call(tools, 'moxi_health');
  assert.equal(health.result.checks.find((c) => c.item === '抖音 bundle').ok, true);
});

test('抖音服务存在但接口不完整时，给出明确错误', async () => {
  const { ctx, tools, external } = fakeCtx();
  await apply(ctx, { home: home() });
  external.moxiDouyin = { call: undefined };
  const out = await call(tools, 'moxi_douyin', {});
  assert.equal(out.result.ok, false);
  assert.match(out.result.error, /抖音|动作/);
});
