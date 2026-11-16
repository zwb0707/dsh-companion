// smoke.test.mjs —— 不依赖 DSH：用一个假 ctx 验证插件注册、工具契约、本地动作能跑
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-moxi-test-'));

function fakeCtx() {
  const tools = [];
  const effects = [];
  const provided = {};
  const ctx = {
    tools: {
      register(definition) { tools.push(definition); return () => { const i = tools.indexOf(definition); if (i >= 0) tools.splice(i, 1); }; },
    },
    effect(fn) { const dispose = fn(); effects.push(dispose); return () => {}; },
    provide(name) { provided[name] = true; },
    logger: { info() {}, warn() {}, error() {} },
  };
  return { ctx, tools, effects, provided };
}

const { apply, name, inject } = await import('../index.mjs');

test('插件以 tools 为依赖并导出一致名称', () => {
  assert.equal(name, 'moxi');
  assert.deepEqual(inject, ['tools']);
});

test('注册全部动作工具，且每个都有 output 契约', async () => {
  const { ctx, tools, provided } = fakeCtx();
  await apply(ctx, { home: HOME });
  assert.equal(tools.length, 51, '49 个运行时动作 + capabilities + docs = 51 个工具');
  assert.ok(provided.moxi, '应暴露 moxi 服务');
  const names = new Set();
  for (const tool of tools) {
    assert.match(tool.name, /^moxi_[a-z0-9_]+$/, '工具名必须小写蛇形：' + tool.name);
    assert.ok(!names.has(tool.name), '工具名重复：' + tool.name);
    names.add(tool.name);
    assert.ok(tool.description?.length > 4, tool.name + ' 缺描述');
    assert.equal(tool.parameters?.type, 'object', tool.name + ' 参数必须是 object schema');
    assert.equal(tool.output?.schema?.type, 'object', tool.name + ' 缺 output.schema');
    assert.equal(typeof tool.output?.render, 'function', tool.name + ' 缺 output.render');
    assert.equal(typeof tool.execute, 'function');
  }
});

test('本地动作真的能跑：capabilities / status / memory / guards / health', async () => {
  const { ctx, tools } = fakeCtx();
  await apply(ctx, { home: HOME });
  const call = (toolName, args) => tools.find((t) => t.name === toolName).execute(args);

  const caps = await call('moxi_capabilities');
  assert.equal(caps.result.ok, true);
  assert.equal(caps.result.count, 51);
  assert.equal(caps.result.actions.length, 51);

  const learn = await call('moxi_learn', { content: '这是一条测试记忆', kind: 'fact' });
  assert.equal(learn.result.ok, true);
  assert.ok(learn.result.id > 0);

  const found = await call('moxi_memory', { op: 'query', query: '测试记忆' });
  assert.equal(found.result.total, 1);

  const status = await call('moxi_status');
  assert.equal(status.result.ok, true);
  assert.equal(status.result.memory.total, 1);

  const guards = await call('moxi_guards');
  assert.equal(guards.result.ok, true);

  const health = await call('moxi_health');
  assert.equal(health.result.ok, true);
  assert.ok(health.result.checks.some((c) => c.item === '记忆库' && c.ok));
  assert.ok(health.result.checks.some((c) => c.item === 'QQ 网关' && !c.ok), '未接网关应如实报未接入');
});

test('未接线的动作返回 not-connected 并说明缺什么', async () => {
  const { ctx, tools } = fakeCtx();
  await apply(ctx, { home: HOME });
  const send = await tools.find((t) => t.name === 'moxi_send').execute({ key: 'private:1', text: 'hi' });
  assert.equal(send.result.ok, false);
  assert.equal(send.result.code, 'not-connected');
  assert.equal(send.result.need, 'gateway');
  assert.match(send.result.error, /OneBot/);
});

test('卸载会注销工具并关库', async () => {
  const { ctx, tools, effects } = fakeCtx();
  await apply(ctx, { home: HOME });
  assert.ok(tools.length > 0);
  for (const dispose of effects) dispose?.();
});
