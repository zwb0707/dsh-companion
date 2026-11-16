// dispatch.mjs —— 动作 → 处理函数。进程内调用，不走 HTTP。
//
// env 由 index.mjs 提供：{ dirs, config, db, memory, log, now, services }
// services 里若有 gateway / agent / douyin / web，就把对应动作交给它们；没有就返回 not-connected 并说明缺什么。

import fs from 'node:fs';
import path from 'node:path';
import { ACTIONS, BY_NAME, NEEDS_HELP, toolName } from './catalog.mjs';
import { ok, fail, notConnected } from './output.mjs';
import { readJson, writeJson, readJsonlTail } from './store.mjs';

const STATE = (dirs, name) => path.join(dirs.state, name);
const DATA = (dirs, name) => path.join(dirs.data, name);

function today(now = Date.now) { return new Date(now()).toISOString().slice(0, 10); }

export function createDispatcher(env) {
  const { dirs, config, db, memory, log, now, services, mood, wakeBudget, fishGuard, turnGuard } = env;

  const handlers = {
    // ── 元信息 ─────────────────────────────────────────────
    capabilities() {
      return ok('moxi_capabilities', {
        version: config.version ?? '0.1.0',
        count: ACTIONS.length,
        actions: ACTIONS.map((a) => ({
          action: a.name, tool: toolName(a.name, config.tools?.prefix ?? 'moxi'),
          needs: a.needs, guard: a.outbound ? '会真的发出去' : a.mutating ? '会改状态' : '',
          summary: a.summary,
        })),
      });
    },

    docs({ name, listOnly } = {}) {
      const files = [
        { key: 'detail', name: '插件说明', path: path.join(import.meta.dirname, '..', 'docs', 'DETAIL.md') },
        { key: 'rules', name: '工具使用规约', path: path.join(import.meta.dirname, '..', 'docs', 'RULES.md') },
      ];
      const want = name ? files.filter((f) => f.key === name) : files;
      const out = want.map((f) => {
        try {
          const raw = fs.readFileSync(f.path, 'utf8');
          return { ...f, chars: raw.length, content: listOnly ? null : raw.slice(0, 100000) };
        } catch (error) { return { ...f, chars: 0, error: String(error?.message ?? error) }; }
      });
      return ok('moxi_docs', { docs: out });
    },

    // ── 状态与自检 ──────────────────────────────────────────
    status() {
      const pause = readJson(STATE(dirs, 'proactive-pause.json'), { until: 0 });
      const mode = readJson(STATE(dirs, 'mode.json'), { mode: 'full', silent: false });
      const stats = memory.stats();
      const usage = db.prepare('SELECT * FROM usage WHERE day = ?').get(today()) ?? { calls: 0, proactive: 0, background: 0 };
      return ok('moxi_status', {
        home: dirs.home,
        version: config.version ?? '0.1.0',
        memory: stats,
        usage: { ...usage, limits: config.limits ?? {} },
        pause: { paused: Number(pause.until) > now(), until: Number(pause.until) || 0 },
        mode,
        mood: mood ? { ...mood.state(), text: mood.describe(), idleMinutes: mood.idleMinutes() } : null,
        purpose: services?.purpose
          ? { enabled: true, target: services.purpose.target(), verdict: services.purpose.shouldSpeak(), state: services.purpose.state() }
          : { enabled: false },
        services: Object.fromEntries(Object.entries(services ?? {}).map(([k, v]) => [k, v && typeof v === 'object' && 'available' in v ? Boolean(v.available) : Boolean(v)])),
      });
    },

    health() {
      const checks = [];
      const add = (item, okFlag, detail) => checks.push({ item, ok: Boolean(okFlag), detail });
      for (const key of ['home', 'data', 'logs', 'state']) add('目录 ' + key, fs.existsSync(dirs[key]), dirs[key]);
      try { db.prepare('SELECT count(*) AS n FROM memory').get(); add('记忆库', true, dirs.db); } catch (e) { add('记忆库', false, String(e?.message ?? e)); }
      add('QQ 网关', Boolean(services?.gateway), services?.gateway ? '已接入' : NEEDS_HELP.gateway);
      add('大脑回合', Boolean(services?.agent), services?.agent ? '已接入' : NEEDS_HELP.agent);
      add('抖音 bundle', Boolean(services?.douyin?.available), services?.douyin?.available ? '已接入' : NEEDS_HELP.douyin);
      add('联网服务', Boolean(services?.web), services?.web ? '已接入' : NEEDS_HELP.web);
      const bad = checks.filter((c) => !c.ok);
      return ok('moxi_health', { checks, okCount: checks.length - bad.length, badCount: bad.length });
    },

    // ── 行为开关 ────────────────────────────────────────────
    guards() {
      return ok('moxi_guards', {
        send: readJson(DATA(dirs, 'send-guard.json'), {}),
        wake: readJson(DATA(dirs, 'wake-budget.json'), {}),
        wakeLimits: { privateMaxPerDay: config.wakeBudget?.privateMaxPerDay ?? 60, groupMaxPerDay: config.wakeBudget?.groupMaxPerDay ?? 80 },
        fish: readJson(STATE(dirs, 'fish-guard.json'), {}),
        turn: { maxMs: turnGuard?.maxMs ?? 180000, maxSteps: turnGuard?.maxSteps ?? 6, maxChars: turnGuard?.maxChars ?? 60000 },
        awake: Boolean(wakeBudget),
        fishGuardReady: Boolean(fishGuard),
      });
    },

    pause({ hours = 2 } = {}) {
      const h = Number(hours);
      if (!Number.isFinite(h) || h < 0 || h > 720) throw new Error('hours 必须在 0..720');
      const until = h === 0 ? 0 : now() + Math.round(h * 3600_000);
      writeJson(STATE(dirs, 'proactive-pause.json'), { until, reason: h === 0 ? '手动恢复' : '手动暂停' });
      return ok('moxi_pause', { paused: until > 0, until });
    },

    pauseStatus() {
      const pause = readJson(STATE(dirs, 'proactive-pause.json'), { until: 0 });
      return ok('moxi_pauseStatus', { paused: Number(pause.until) > now(), until: Number(pause.until) || 0, reason: pause.reason ?? '' });
    },

    mode(params = {}) {
      const current = readJson(STATE(dirs, 'mode.json'), { mode: 'full', silent: false });
      const next = { ...current };
      if (typeof params.mode === 'string' && params.mode) next.mode = params.mode;
      if (typeof params.silent === 'boolean') next.silent = params.silent;
      if (Object.keys(params).length) writeJson(STATE(dirs, 'mode.json'), next);
      return ok('moxi_mode', next);
    },

    // ── 统计类 ─────────────────────────────────────────────
    rhythm() {
      return ok('moxi_rhythm', { groups: readJson(DATA(dirs, 'group-rhythm.json'), {}) });
    },

    groupTick({ group } = {}) {
      const all = readJson(DATA(dirs, 'group-rhythm.json'), {});
      if (group) return ok('moxi_groupTick', { group, stats: all[group] ?? null });
      return ok('moxi_groupTick', { groups: Object.keys(all) });
    },

    socialState() {
      const access = config.access ?? {};
      return ok('moxi_socialState', {
        allow: access.allow ?? { private: [], groups: [] },
        deny: access.deny ?? { private: [], groups: [] },
        strictGroups: access.strictGroups !== false,
      });
    },

    billing({ days = 7 } = {}) {
      const rows = db.prepare('SELECT * FROM usage ORDER BY day DESC LIMIT ?').all(Math.min(30, Math.max(1, Number(days) || 7)));
      const sum = rows.reduce((a, r) => ({ calls: a.calls + r.calls, proactive: a.proactive + r.proactive, background: a.background + r.background, inputTokens: a.inputTokens + r.input_tokens, outputTokens: a.outputTokens + r.output_tokens }), { calls: 0, proactive: 0, background: 0, inputTokens: 0, outputTokens: 0 });
      return ok('moxi_billing', { days: rows, total: sum });
    },

    audit({ limit = 50 } = {}) {
      return ok('moxi_audit', { items: readJsonlTail(DATA(dirs, 'audit.jsonl'), Math.min(200, Number(limit) || 50)) });
    },

    logs({ query = '', lines = 80 } = {}) {
      const files = fs.existsSync(dirs.logs) ? fs.readdirSync(dirs.logs).filter((f) => f.endsWith('.log')) : [];
      const out = [];
      for (const f of files) {
        try {
          const tail = fs.readFileSync(path.join(dirs.logs, f), 'utf8').trim().split(/\r?\n/).slice(-Math.min(400, Number(lines) || 80));
          for (const line of tail) if (!query || line.includes(query)) out.push({ file: f, line: line.slice(0, 400) });
        } catch { /* 忽略不可读 */ }
      }
      return ok('moxi_logs', { count: out.length, items: out.slice(-Math.min(200, Number(lines) || 80)) });
    },

    // ── 记忆 ───────────────────────────────────────────────
    memory(params = {}) {
      const op = String(params.op ?? 'query');
      if (op === 'query' || op === 'list') return ok('moxi_memory', memory.query(params));
      if (op === 'add') return ok('moxi_memory', memory.add({ kind: params.kind ?? 'fact', content: params.content, source: 'self' }));
      if (op === 'update') return ok('moxi_memory', memory.update(params));
      if (op === 'delete') return ok('moxi_memory', memory.delete(params));
      if (op === 'pin') return ok('moxi_memory', memory.update({ id: params.id, pinned: params.pinned !== false }));
      throw new Error('未知 op：' + op);
    },

    learn({ content, kind = 'fact', source = 'self' } = {}) {
      return ok('moxi_learn', memory.add({ kind, content, source, weight: 1.1 }));
    },

    commitments({ op = 'list', text, id, note } = {}) {
      if (op === 'add') {
        if (!text || !String(text).trim()) throw new Error('text 不能为空');
        const info = db.prepare('INSERT INTO commitments (text, created_at) VALUES (?,?)').run(String(text).trim(), now());
        return ok('moxi_commitments', { id: Number(info.lastInsertRowid) });
      }
      if (op === 'done') {
        const info = db.prepare('UPDATE commitments SET done_at = ? WHERE id = ? AND done_at IS NULL').run(now(), Number(id));
        return ok('moxi_commitments', { updated: info.changes });
      }
      const open = db.prepare('SELECT id, text, created_at FROM commitments WHERE done_at IS NULL ORDER BY id DESC LIMIT 50').all();
      return ok('moxi_commitments', { open, note: note ?? '' });
    },

    slang({ op = 'query', q = '', content = '', context = '' } = {}) {
      if (op === 'submit') {
        db.prepare('INSERT INTO slang (term, meaning, usage, created_at) VALUES (?,?,?,?) ON CONFLICT(term) DO NOTHING')
          .run(String(content).trim().slice(0, 50), '', String(context).slice(0, 200), now());
        return ok('moxi_slang', { submitted: content });
      }
      const items = q
        ? db.prepare('SELECT term, meaning, usage, confirmed FROM slang WHERE term LIKE ? OR meaning LIKE ? LIMIT 50').all(`%${q}%`, `%${q}%`)
        : db.prepare('SELECT term, meaning, usage, confirmed FROM slang WHERE confirmed = 1 LIMIT 50').all();
      return ok('moxi_slang', { items });
    },

    // ── 表情与形象 ──────────────────────────────────────────
    stickers({ query = '' } = {}) {
      const s = readJson(DATA(dirs, 'stickers.json'), { items: [] });
      const items = (s.items ?? []).filter((x) => !query || JSON.stringify(x).includes(query));
      return ok('moxi_stickers', { count: items.length, items });
    },

    faces({ op = 'list', id, emotion, content } = {}) {
      const s = readJson(DATA(dirs, 'stickers.json'), { items: [] });
      if (op === 'add' && id) {
        s.items = [...(s.items ?? []), { id, emotion: emotion ?? '', content: content ?? '', addedAt: now() }];
        writeJson(DATA(dirs, 'stickers.json'), s);
      }
      return ok('moxi_faces', { items: s.items ?? [] });
    },

    stickerImage({ stickerId } = {}) {
      const s = readJson(DATA(dirs, 'stickers.json'), { items: [] });
      const item = (s.items ?? []).find((x) => x.id === stickerId);
      if (!item) return fail('moxi_stickerImage', '没有这个表情：' + stickerId);
      const file = item.path ? path.resolve(dirs.media, item.path) : null;
      if (!file || !fs.existsSync(file)) return fail('moxi_stickerImage', '表情文件不在本机');
      return ok('moxi_stickerImage', { item }, [{ path: file }], '已附上表情图片。');
    },

    selfImage() {
      const file = path.join(import.meta.dirname, '..', 'assets', 'self.png');
      if (!fs.existsSync(file)) return ok('moxi_selfImage', { available: false }, [], '这个插件没有附带形象图。');
      return ok('moxi_selfImage', { available: true }, [{ path: file }], '已附上形象图。');
    },

    // ── 队列 ───────────────────────────────────────────────
    clearOutbox() {
      writeJson(DATA(dirs, 'outbox.json'), []);
      return ok('moxi_clearOutbox', { cleared: true });
    },

    myRecent({ limit = 20 } = {}) {
      const rows = db.prepare("SELECT peer, content, at FROM turns WHERE role = 'her' ORDER BY at DESC LIMIT ?").all(Math.min(100, Number(limit) || 20));
      return ok('moxi_myRecent', { items: rows });
    },
  };

  // ── 需要外部服务的动作：有服务就转交，没有就说明缺什么 ──
  const proxy = {
    gateway: ['groups', 'activeMembers', 'recent', 'unread', 'context', 'messageDetail', 'media', 'mark-read', 'wait', 'catchup', 'send', 'burst', 'sendImage', 'forward', 'poke', 'react', 'mediaShare', 'stickerCollect'],
    agent: ['simulate', 'report', 'purposeMaterials', 'wake', 'close'],
    douyin: ['douyin', 'douyinAccount'],
    web: ['webSearch', 'webFetch'],
  };

  return async function dispatch(action, params = {}) {
    const spec = BY_NAME.get(action);
    if (!spec) return fail(toolName(action), '未知动作：' + action);

    if (handlers[action]) {
      try { return await handlers[action](params); }
      catch (error) { log?.('[moxi] ' + action + ' 失败：' + String(error?.message ?? error)); return fail(toolName(action), error?.message ?? error); }
    }

    const group = Object.keys(proxy).find((key) => proxy[key].includes(action));
    if (group) {
      const service = services?.[group];
      if (!service || typeof service.call !== 'function' || service.available === false) return notConnected(toolName(action), group, NEEDS_HELP[group]);
      try { return await service.call(action, params); }
      catch (error) {
        if (error?.code === 'NOT_CONNECTED') return notConnected(toolName(action), group, NEEDS_HELP[group]);
        return fail(toolName(action), error?.message ?? error);
      }
    }

    return fail(toolName(action), '动作没有实现：' + action);
  };
}
