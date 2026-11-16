// contract.test.mjs —— 把 DSH 宿主在 tools.register() 时做的校验搬成回归测试
//
// 依据（安装包源码，0.2.2-rc.3）：
//   node_modules/@deepseek-ai/dsh-tools/lib/index.js:433-445
//     · definition.output 必须是对象且 output.render 是函数（presentationMeta 可选函数）
//     · output.schema 必须通过 assertSupportedJsonSchema
//     · timeoutMs 若给必须是正的有限数
//     · 禁止使用保留名 run_code
//   同形状的输出契约在现有可用插件 @local/her-douyin 里已在生产跑通（NATIVE_OUTPUT_SCHEMA）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { OUTPUT_SCHEMA } from '../src/output.mjs';
import { buildToolDefinitions } from '../src/tools.mjs';
import { ACTIONS } from '../src/catalog.mjs';
import { apply } from '../index.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-moxi-contract-'));
const definitions = buildToolDefinitions(async () => ({ tool: 'noop', result: { ok: true }, images: [], imageStatus: '' }));

test('每个定义都符合宿主的 register 校验', () => {
  const names = new Set();
  for (const d of definitions) {
    assert.equal(typeof d.name, 'string');
    assert.notEqual(d.name, 'run_code', 'run_code 是宿主保留名');
    assert.ok(!names.has(d.name), '工具名重复：' + d.name);
    names.add(d.name);

    assert.equal(typeof d.description, 'string');
    assert.ok(d.description.trim().length > 4, d.name + ' 描述太短');

    // 参数必须是 object schema
    assert.equal(d.parameters?.type, 'object', d.name + ' 参数必须是 object schema');
    assert.equal(typeof d.parameters.properties, 'object');

    // output 契约
    assert.equal(typeof d.output, 'object', d.name + ' 缺 output');
    assert.equal(typeof d.output.render, 'function', d.name + ' 缺 output.render');
    assert.equal(typeof d.output.schema, 'object', d.name + ' 缺 output.schema');
    if (d.output.presentationMeta !== undefined) assert.equal(typeof d.output.presentationMeta, 'function');

    // timeout
    if (d.timeoutMs !== undefined) {
      assert.ok(Number.isFinite(d.timeoutMs) && d.timeoutMs > 0, d.name + ' timeoutMs 必须是正数');
    }
    assert.equal(typeof d.execute, 'function');
  }
  assert.equal(definitions.length, ACTIONS.length);
});

test('输出 schema 与生产插件同形状（防手滑改坏）', () => {
  assert.deepEqual(Object.keys(OUTPUT_SCHEMA.properties).sort(), ['imageStatus', 'images', 'result', 'tool']);
  assert.deepEqual(OUTPUT_SCHEMA.required.slice().sort(), ['imageStatus', 'images', 'result', 'tool']);
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false);
  assert.equal(OUTPUT_SCHEMA.properties.result.type, 'object');
  assert.equal(OUTPUT_SCHEMA.properties.images.type, 'array');
  assert.equal(OUTPUT_SCHEMA.properties.images.items.type, 'object');
});

test('apply 不返回值（Cordis 把插件返回值当 disposer，返回对象会报 Invalid effect）', async () => {
  const tools = [];
  const ctx = {
    tools: { register(d) { tools.push(d); return () => {}; } },
    effect(fn) { const d = fn(); return () => d?.(); },
    provide() {}, get() { return null; },
    timer: { interval() { return () => {}; } },
    logger: { info() {}, warn() {}, error() {} },
  };
  const returned = await apply(ctx, { home });
  assert.equal(returned, undefined);
  assert.equal(tools.length, ACTIONS.length);
  assert.ok(ctx.moxi, '服务应挂在 ctx.moxi 上');
});

test('prefix 配置能改工具名前缀（同名冲突时的逃生门）', () => {
  const defs = buildToolDefinitions(async () => ({}), { prefix: 'moxit' });
  assert.ok(defs.every((d) => d.name.startsWith('moxit_')));
  assert.ok(defs.some((d) => d.name === 'moxit_status'));
});

test('render 同时兼容 render(value) 与 render(args, value)', () => {
  const value = { tool: 'moxi_status', result: { ok: true }, images: [], imageStatus: '无' };
  const render1 = buildToolDefinitions(async () => ({})).find((d) => d.name === 'moxi_status').output.render;
  const a = render1(value);
  const b = render1({ some: 'args' }, value);
  assert.match(a[0].text, /moxi_status/);
  assert.match(b[0].text, /moxi_status/, 'args 在前时也必须渲染出真正的输出值');
  assert.equal(a[0].text, b[0].text);
});

test('注册后的工具返回值满足声明结构', async () => {
  const tools = [];
  const ctx = {
    tools: { register(d) { tools.push(d); return () => {}; } },
    effect(fn) { const d = fn(); return () => d?.(); },
    provide() {},
    get() { return null; },
    timer: { interval() { return () => {}; } },
    logger: { info() {}, warn() {}, error() {} },
  };
  await apply(ctx, { home });
  assert.equal(tools.length, ACTIONS.length);

  const sample = ['moxi_status', 'moxi_health', 'moxi_capabilities', 'moxi_guards', 'moxi_pause_status', 'moxi_social_state'];
  for (const name of sample) {
    const tool = tools.find((t) => t.name === name);
    const value = await tool.execute({});
    assert.equal(typeof value.tool, 'string', name);
    assert.equal(typeof value.result, 'object', name);
    assert.ok(Array.isArray(value.images), name);
    assert.equal(typeof value.imageStatus, 'string', name);
    // 渲染函数必须吃这套值
    const rendered = tool.output.render(value);
    assert.ok(Array.isArray(rendered) && rendered.length >= 1, name + ' render 没返回内容');
    assert.equal(rendered[0].type, 'text');
    assert.equal(typeof rendered[0].text, 'string');
  }
});
