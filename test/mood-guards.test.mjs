// mood-guards.test.mjs —— 心情推进与四个护栏
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMood } from '../src/core/mood.mjs';
import { scanOutbound, createTurnBudget, createWakeBudget, createFishGuard } from '../src/core/guards.mjs';
import { resolveHome, ensureHome } from '../src/home.mjs';

const tmpDirs = () => ensureHome(resolveHome({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-moxi-mood-')) }), {});

test('心情：时间推进会漂移，他能压下去', () => {
  let clock = 1_800_000_000_000;
  const dirs = tmpDirs();
  const mood = createMood({ dirs, now: () => clock });
  const before = mood.state();
  clock += 3600_000;
  const later = mood.state();
  assert.ok(later.longing > before.longing, '一小时后又更想他');
  assert.ok(later.warmth < before.warmth + 100);

  const after = mood.onUserMessage();
  assert.ok(after.longing < later.longing, '他说话后想念下降');
  assert.ok(after.warmth > later.warmth, '他说话后暖上升');
  assert.equal(typeof mood.describe(), 'string');
  assert.ok(mood.idleMinutes() >= 0);
});

test('出站安检：路径/令牌/端口/内部实现都会被替换', () => {
  const dirty = '看 D:\\her\\data\\x 和 Bearer abcdefghijklmnop 还有 127.0.0.1:3155 以及 run-qq.mjs';
  const { clean, leaks } = scanOutbound(dirty);
  assert.ok(leaks.length >= 3, '应识别出多处泄漏：' + JSON.stringify(leaks));
  assert.ok(!clean.includes('D:\\her'), clean);
  assert.ok(!clean.includes('127.0.0.1:3155'), clean);
  assert.ok(clean.includes('（'), '被替换的地方应有遮罩');
});

test('回合预算：步数超限会抛', () => {
  const budget = createTurnBudget({ maxSteps: 2, maxMs: 10_000, maxChars: 100 });
  budget.step();
  budget.step();
  assert.throws(() => budget.step(), /步数/);
  const other = createTurnBudget({ maxChars: 10 });
  assert.throws(() => other.addChars(11), /文本/);
});

test('唤醒额度：按天按类限制', () => {
  const dirs = tmpDirs();
  let clock = Date.now();
  const budget = createWakeBudget({ dirs, config: { privateMaxPerDay: 1, groupMaxPerDay: 2, minGapMs: 0 }, now: () => clock });
  assert.equal(budget.check('private:1').allowed, true);
  budget.use('private:1');
  assert.equal(budget.check('private:1').allowed, false);
  assert.throws(() => budget.use('private:1'), /额度/);
  clock += 24 * 3600_000;
  assert.equal(budget.check('private:1').allowed, true, '第二天恢复');
});

test('群冷却：进入冷却后 check 为真，时间到解除', () => {
  const dirs = tmpDirs();
  let clock = Date.now();
  const fish = createFishGuard({ dirs, now: () => clock, cooldownMs: 60_000 });
  assert.equal(fish.check('800000000').cooling, false);
  fish.mark('800000000');
  assert.equal(fish.check('800000000').cooling, true);
  clock += 61_000;
  assert.equal(fish.check('800000000').cooling, false);
});
