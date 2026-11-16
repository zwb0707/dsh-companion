// guards.mjs —— 四个护栏：出站安检、回合预算、唤醒额度、群冷却
//
// 都不开定时器，纯函数 + 少量落盘，调用方（工具或主动开口）在需要时查一下。

import path from 'node:path';
import { readJson, writeJson } from '../store.mjs';

/** 出站安检：回复里不许出现本地路径、令牌、内部实现名、本机端口 */
const LEAK_PATTERNS = [
  { re: /[A-Za-z]:\\[^\s，。；）)]{3,}/g, label: '本地路径', mask: '（一个本地路径）' },
  { re: /\bBearer\s+[A-Za-z0-9._-]{8,}/g, label: '令牌', mask: '（令牌）' },
  { re: /\b[a-z0-9]{32,}\b/gi, label: '长串密钥', mask: '（密钥）' },
  { re: /(access_token|accessToken|httpToken|console-token|x-agent-token)\s*[:=]?\s*\S+/gi, label: '令牌字段', mask: '（令牌）' },
  { re: /\b(session-[0-9a-f]{8}|sessionId)\b/gi, label: '内部会话标识', mask: '（会话）' },
  { re: /\b(OpenAI|DeepSeek Harness|DSH API|run-qq\.mjs|control-api|mcp-her-tools)\b/gi, label: '内部实现', mask: '（内部实现）' },
  { re: /127\.0\.0\.1:\d{2,5}/g, label: '本机端口', mask: '（本地端口）' },
];

export function scanOutbound(text) {
  let clean = String(text ?? '');
  const leaks = [];
  for (const p of LEAK_PATTERNS) {
    clean = clean.replace(p.re, (match) => {
      leaks.push({ label: p.label, sample: match.slice(0, 40) });
      return p.mask;
    });
  }
  return { clean, leaks };
}

export function createTurnBudget({ maxMs = 180000, maxSteps = 6, maxChars = 60000 } = {}) {
  const startedAt = Date.now();
  let steps = 0;
  let chars = 0;
  return {
    step(n = 1) {
      steps += n;
      if (Date.now() - startedAt > maxMs) throw Object.assign(new Error('回合超时（' + maxMs + 'ms）'), { code: 'TURN_TIMEOUT' });
      if (steps > maxSteps) throw Object.assign(new Error('回合步数超上限（' + maxSteps + '）'), { code: 'TURN_STEPS' });
    },
    addChars(n = 0) {
      chars += Number(n) || 0;
      if (chars > maxChars) throw Object.assign(new Error('回合文本超上限（' + maxChars + '）'), { code: 'TURN_CHARS' });
    },
    get used() { return { steps, chars, ms: Date.now() - startedAt }; },
  };
}

export function createWakeBudget({ dirs, config = {}, now = Date.now }) {
  const file = path.join(dirs.data, 'wake-budget.json');
  const privateMax = Number(config.privateMaxPerDay ?? 60);
  const groupMax = Number(config.groupMaxPerDay ?? 80);
  const minGapMs = Number(config.minGapMs ?? 5000);
  const day = () => new Date(now()).toISOString().slice(0, 10);

  function read() { return readJson(file, {}); }

  return {
    /** 是否还能唤醒（不累加） */
    check(key) {
      const state = read();
      const entry = state[key] ?? {};
      const limit = key.startsWith('group:') ? groupMax : privateMax;
      const count = entry.day === day() ? Number(entry.count ?? 0) : 0;
      const gapLeft = Math.max(0, minGapMs - (now() - Number(entry.lastAt ?? 0)));
      return { allowed: count < limit && gapLeft === 0, count, limit, gapLeftMs: gapLeft };
    },
    /** 真正唤醒一次才累加 */
    use(key) {
      const state = read();
      const entry = state[key] ?? {};
      const limit = key.startsWith('group:') ? groupMax : privateMax;
      const count = entry.day === day() ? Number(entry.count ?? 0) : 0;
      if (count >= limit) throw new Error(`${key} 今日唤醒额度已用完（${limit}）`);
      state[key] = { day: day(), count: count + 1, lastAt: now() };
      writeJson(file, state);
      return state[key];
    },
  };
}

export function createFishGuard({ dirs, now = Date.now, cooldownMs = 10 * 60_000 }) {
  const file = path.join(dirs.state, 'fish-guard.json');
  return {
    /** 群里是不是在冷却（避免连续接话） */
    check(group) {
      const state = readJson(file, {});
      const until = Number(state[group]?.until ?? 0);
      return { cooling: until > now(), remainMs: Math.max(0, until - now()) };
    },
    mark(group, ms = cooldownMs) {
      const state = readJson(file, {});
      state[group] = { until: now() + ms, at: now() };
      writeJson(file, state);
      return state[group];
    },
  };
}
