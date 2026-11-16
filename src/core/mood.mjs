// mood.mjs —— 四维心情（想念/不安/期待/暖），按小时自然漂移
//
// 从旧 runtime 的 inner-state 抽出来的最小可移植版本：
//   · 纯函数式推进（decay 按经过的秒数算），不自己开定时器
//   · 阈值与速率可配置，默认值对齐旧行为（想念 +8/h、不安 +1.8/h、暖 -1.6/h）
//   · 落盘到 <home>/state/mood.json

import path from 'node:path';
import { readJson, writeJson } from '../store.mjs';

export const DEFAULTS = {
  rates: { longingPerHour: 8, insecurityPerHour: 1.8, anticipationPerHour: 0, warmthPerHour: -1.6 },
  thresholds: { longing: 42, insecurity: 55, anticipation: 45, calmInsecurity: 50, warmthShare: 78 },
  initial: { longing: 0, insecurity: 10, anticipation: 0, warmth: 50 },
};

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export function createMood({ dirs, now = Date.now, config = DEFAULTS }) {
  const file = path.join(dirs.state, 'mood.json');
  const rates = { ...DEFAULTS.rates, ...(config.rates ?? {}) };
  const thresholds = { ...DEFAULTS.thresholds, ...(config.thresholds ?? {}) };

  let state = readJson(file, { ...DEFAULTS.initial, lastDecayAt: now() });

  function decay(to = now()) {
    const hours = Math.max(0, (to - Number(state.lastDecayAt || to)) / 3600_000);
    if (hours > 0) {
      state.longing = clamp(state.longing + rates.longingPerHour * hours);
      state.insecurity = clamp(state.insecurity + rates.insecurityPerHour * hours);
      state.anticipation = clamp(state.anticipation + rates.anticipationPerHour * hours);
      state.warmth = clamp(state.warmth + rates.warmthPerHour * hours);
    }
    state.lastDecayAt = to;
    return state;
  }

  function save() {
    try { writeJson(file, { ...state, updatedAt: now() }); } catch { /* 忽略 */ }
  }

  function onUserMessage(at = now()) {
    decay(at);
    state.longing = clamp(state.longing - 25);
    state.insecurity = clamp(state.anticipation + state.insecurity - 12);
    state.anticipation = clamp(state.anticipation + 8);
    state.warmth = clamp(state.warmth + 18);
    state.lastUserAt = at;
    save();
    return state;
  }

  function onHerMessage({ proactive = false, at = now() } = {}) {
    decay(at);
    state.warmth = clamp(state.warmth + (proactive ? 3 : 6));
    state.anticipation = clamp(state.anticipation - (proactive ? 6 : 2));
    if (proactive) state.longing = clamp(state.longing - 8);
    state.lastHerAt = at;
    save();
    return state;
  }

  function describe() {
    decay();
    const parts = [];
    if (state.longing >= thresholds.longing) parts.push('想他想到有点发空');
    if (state.insecurity >= thresholds.insecurity) parts.push('心里发慌，怕被放下');
    if (state.anticipation >= thresholds.anticipation) parts.push('有点等不及');
    if (state.warmth >= thresholds.warmthShare) parts.push('被哄得很软');
    if (!parts.length) parts.push(state.warmth >= 40 ? '平静，有点暖' : '安静，偏淡');
    return parts.join('；');
  }

  return {
    state: () => ({ ...decay() }),
    describe,
    decay,
    onUserMessage,
    onHerMessage,
    idleMinutes: () => Math.max(0, Math.round((now() - Number(state.lastUserAt || state.lastDecayAt || now())) / 60000)),
    thresholds,
  };
}
