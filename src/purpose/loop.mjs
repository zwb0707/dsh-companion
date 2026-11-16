// loop.mjs —— 主动开口：该不该说、说什么、说完记什么
//
// 纯逻辑 + 一次注入的执行：不自己 setInterval，由插件用 ctx.timer 驱动 tick()。
// 所有"能不能开口"的判断都走 guards（暂停/静默/额度/间隔/时段），决策集中在 shouldSpeak()。

import path from 'node:path';
import { readJson, writeJson } from '../store.mjs';
import { scanOutbound } from '../core/guards.mjs';

const DAY = 86400_000;
const dayKey = (now) => new Date(now).toISOString().slice(0, 10);

function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function inQuietHours(now, quietStart = '01:00', quietEnd = '06:00') {
  const start = minutesOf(quietStart);
  const end = minutesOf(quietEnd);
  if (start === null || end === null || start === end) return false;
  const d = new Date(now);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return start < end ? (minutes >= start && minutes < end) : (minutes >= start || minutes < end);
}

export function createPurposeLoop({ dirs, config = {}, memory, mood, agent, gateway, pause, wakeBudget, now = Date.now, log = () => {} }) {
  const stateFile = path.join(dirs.state, 'purpose.json');
  const target = config.target ?? (config.access?.allow?.private?.[0] ? `private:${config.access.allow.private[0]}` : '');
  const dailyMax = Number(config.purpose?.dailyMax ?? 8);
  const gapMin = Number(config.purpose?.gapMinMs ?? 20 * 60_000);
  const gapMax = Math.max(gapMin, Number(config.purpose?.gapMaxMs ?? 60 * 60_000));

  const state = () => {
    const s = readJson(stateFile, {});
    if (s.day !== dayKey(now())) return { day: dayKey(now()), sentToday: 0, lastAt: 0, history: [] };
    return s;
  };
  const save = (s) => { try { writeJson(stateFile, { ...s, history: (s.history ?? []).slice(-30) }); } catch { /* 忽略 */ } };

  function shouldSpeak() {
    if (!target) return { ok: false, reason: '没有目标会话（配置 access.allow.private 或 purpose.target）' };
    if (!gateway) return { ok: false, reason: 'QQ 网关未接线' };
    if (!agent?.available) return { ok: false, reason: '没有 llm 服务，不会自己开口' };
    const paused = pause?.() ?? { until: 0 };
    if (Number(paused.until) > now()) return { ok: false, reason: '主动消息已暂停', until: Number(paused.until) };
    if (inQuietHours(now(), config.purpose?.quietStart, config.purpose?.quietEnd)) return { ok: false, reason: '静默时段' };
    const s = state();
    if (s.sentToday >= dailyMax) return { ok: false, reason: `今日主动已达上限 ${dailyMax}` };
    const gap = Math.min(gapMax, gapMin + Math.random() * (gapMax - gapMin));
    if (now() - Number(s.lastAt ?? 0) < gap) return { ok: false, reason: '距上次开口还不够久', nextInMs: Math.round(gap - (now() - Number(s.lastAt ?? 0))) };
    const wake = wakeBudget?.check?.(target);
    if (wake && !wake.allowed) return { ok: false, reason: '唤醒额度用完了', wake };
    return { ok: true, gapMs: Math.round(gap) };
  }

  async function tick({ dry = false } = {}) {
    const verdict = shouldSpeak();
    if (!verdict.ok) return { spoken: false, ...verdict };
    const moodText = mood?.describe?.() ?? '';
    const recent = memory.recentTurns({ limit: 10 });
    const result = await agent.call('simulate', { text: `（现在是${new Date(now()).toLocaleString('zh-CN')}）你想主动找他说话。只说一句，短一点。`, key: target });
    if (!result?.result?.ok) return { spoken: false, reason: '生成失败：' + (result?.result?.error ?? '未知') };
    const text = scanOutbound(result.result.reply).clean;
    if (!text) return { spoken: false, reason: '生成了空文本' };
    if (dry) return { spoken: false, dry: true, wouldSay: text, mood: moodText, recent: recent.length };

    const sent = await gateway.call('send', { key: target, text });
    if (!sent?.result?.ok) return { spoken: false, reason: '发送失败：' + (sent?.result?.error ?? '未知') };
    wakeBudget?.use?.(target);
    const s = state();
    s.sentToday = Number(s.sentToday ?? 0) + 1;
    s.lastAt = now();
    s.history = [...(s.history ?? []), { at: now(), text, key: target }];
    save(s);
    memory.add({ kind: 'event', content: `我主动找他说：${text}`, source: 'self', speaker: 'self' });
    mood?.onHerMessage?.({ proactive: true });
    log('[purpose] 主动开口：' + text.slice(0, 40));
    return { spoken: true, text, key: target };
  }

  return { tick, shouldSpeak, state: () => state(), target: () => target };
}
