// service.mjs —— 5 个「大脑回合」动作：演练、日报、目的素材、唤醒、收尾
//
// 只有 simulate 真的调模型；其余四个是本地计算/落盘，不烧 token。

import fs from 'node:fs';
import path from 'node:path';
import { ok, fail } from '../output.mjs';
import { readJson, writeJson } from '../store.mjs';
import { buildSystem, buildMessages, readPersona } from './prompt.mjs';
import { createLlmRunner } from './llm.mjs';
import { scanOutbound } from '../core/guards.mjs';

const day = (now = Date.now) => new Date(now()).toISOString().slice(0, 10);

export function createAgentService({ dirs, config = {}, db, memory, mood, llm, log = () => {}, now = Date.now, selection }) {
  const runner = createLlmRunner({ llm, config: { provider: config.provider, model: config.model }, log });
  /** 每次调用现取路由：先看配置，再看 DSH 的默认模型选择 */
  const route = () => {
    if (config.provider && config.model) return { provider: config.provider, model: config.model };
    try {
      const picked = selection?.();
      if (picked?.provider && picked?.model) return picked;
    } catch { /* 忽略 */ }
    return { provider: undefined, model: undefined };
  };
  const wakeFile = path.join(dirs.state, 'wake.json');
  const closureFile = path.join(dirs.state, 'closure.json');

  function recordUsage({ inputTokens = 0, outputTokens = 0 } = {}) {
    const today = day(now);
    try {
      db.prepare(`INSERT INTO usage (day, calls, proactive, background, input_tokens, output_tokens) VALUES (?,1,0,0,?,?)
        ON CONFLICT(day) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`)
        .run(today, inputTokens, outputTokens);
    } catch (error) { log('[agent] 用量记账失败：' + String(error?.message ?? error)); }
  }

  const handlers = {
    async simulate({ text = '', key = '' } = {}) {
      if (!String(text).trim()) return fail('moxi_simulate', '需要 text');
      if (!runner.available) {
        return { tool: 'moxi_simulate', result: { ok: false, code: 'not-connected', need: 'agent', error: '当前 profile 没有 llm 服务，无法演练。' }, images: [], imageStatus: '本次操作没有采集画面。' };
      }
      const system = buildSystem({ dirs, moodText: mood?.describe?.() ?? '', rules: '演练模式：只生成她会怎么回，不要真的发送，也不要承诺已发送。' });
      const messages = buildMessages({ memory, key, limit: config.history?.limit ?? 12, userText: text });
      const result = await runner.run({ ...route(), system, messages, maxTokens: config.replyTokens ?? 512, purpose: 'moxi-simulate' });
      const masked = scanOutbound(result.text);
      recordUsage({ inputTokens: result.usage?.inputTokens ?? 0, outputTokens: result.usage?.outputTokens ?? 0 });
      return ok('moxi_simulate', {
        dry: true,
        reply: masked.clean,
        maskedLeaks: masked.leaks,
        usage: result.usage ?? null,
        route: result.route,
      });
    },

    async report() {
      const stats = memory.stats();
      const usage = db.prepare('SELECT * FROM usage WHERE day = ?').get(day(now)) ?? { calls: 0 };
      const moodState = mood?.state?.() ?? {};
      const moodText = mood?.describe?.() ?? '';
      const herTurns = memory.recentTurns({ limit: 8 }).filter((t) => t.role === 'her');
      const open = db.prepare('SELECT text FROM commitments WHERE done_at IS NULL ORDER BY id DESC LIMIT 10').all();
      const facts = memory.query({ kind: 'fact', limit: 5 }).items;
      const pendings = memory.query({ kind: 'pending', limit: 5 }).items;
      const lines = [
        `# ${day(now)} · 日报`,
        '',
        `- 心情：${moodText}（想念 ${Math.round(moodState.longing ?? 0)} / 不安 ${Math.round(moodState.insecurity ?? 0)} / 期待 ${Math.round(moodState.arousal ?? moodState.anticipation ?? 0)} / 暖 ${Math.round(moodState.warmth ?? 0)}）`,
        `- 记忆：${stats.total} 条（${(stats.byKind ?? []).map((k) => k.kind + '=' + k.n).join(' ') || '空'}）`,
        `- 今天调用：${Number(usage.calls ?? 0)} 次`,
        facts.length ? `- 记住的事：\n${facts.map((m) => '  - ' + String(m.content).slice(0, 80)).join('\n')}` : '- 记住的事：无',
        pendings.length ? `- 还悬着的：\n${pendings.map((m) => '  - ' + String(m.content).slice(0, 80)).join('\n')}` : '- 还悬着的：无',
        open.length ? `- 未完成约定：\n${open.map((c) => '  - ' + c.text).join('\n')}` : '- 未完成约定：无',
        herTurns.length ? `- 她最近说过：\n${herTurns.map((t) => '  - ' + String(t.content).slice(0, 80)).join('\n')}` : '- 她最近说过：（还没有记录）',
      ];
      const markdown = lines.join('\n');
      const file = path.join(dirs.data, `report-${day(now)}.md`);
      try { fs.writeFileSync(file, markdown, 'utf8'); } catch (error) { log('[agent] 日报落盘失败：' + String(error?.message ?? error)); }
      return ok('moxi_report', { date: day(now), markdown, path: file });
    },

    async purposeMaterials({ limit = 6 } = {}) {
      const n = Math.min(20, Math.max(1, Number(limit) || 6));
      const feeling = memory.query({ kind: 'feeling', limit: n }).items;
      const pending = memory.query({ kind: 'pending', limit: n }).items;
      const facts = memory.query({ kind: 'fact', limit: n }).items;
      const pool = [...pending, ...feeling, ...facts];
      if (!pool.length) return ok('moxi_purposeMaterials', { items: [], note: '记忆还是空的，先聊点东西或 moxi_learn 写几条。' });
      const items = pool.slice(0, n).map((m) => ({
        goalId: 'mem-' + m.id,
        statement: String(m.content).slice(0, 80),
        source: m.kind,
        confidence: 0.6,
      }));
      return ok('moxi_purposeMaterials', { items, mood: mood?.describe?.() ?? '' });
    },

    async wake({ key = '', config: wakeConfig } = {}) {
      const state = readJson(wakeFile, {});
      if (wakeConfig === undefined) return ok('moxi_wake', { key, current: state[key] ?? null });
      state[key] = { ...(wakeConfig ?? {}), updatedAt: now() };
      writeJson(wakeFile, state);
      return ok('moxi_wake', { key, saved: state[key], note: '这里只是插件自己的唤醒条件；真正叫醒 agent 由 DSH 的调度决定。' });
    },

    async close({ key = '', summary = '', nextOpening = '', reason = 'natural' } = {}) {
      const state = readJson(closureFile, {});
      const record = { key, summary: String(summary).slice(0, 200), nextOpening: String(nextOpening).slice(0, 120), reason, at: now() };
      state[key || 'default'] = record;
      writeJson(closureFile, state);
      if (summary) memory.add({ kind: 'event', content: `这段对话收在：${summary}`, source: 'self', speaker: 'self' });
      return ok('moxi_close', record);
    },
  };

  return {
    available: runner.available,
    route: runner.route,
    async call(action, params) {
      const handler = handlers[action];
      if (!handler) throw new Error('大脑服务不支持的动作：' + action);
      return handler(params ?? {});
    },
    persona: () => readPersona(dirs),
  };
}
