// index.mjs —— dsh-moxi 插件入口（Cordis Host 插件）
//
// 一个插件装完就有：本地人格/记忆/情绪/守卫/主动开口的底座 + 49 个动作工具。
// QQ 网关、抖音、联网都由外部服务提供：有就接，没有就把动作标成 not-connected（不是静默失败）。

import fs from 'node:fs';
import path from 'node:path';

import { resolveHome, ensureHome, readConfig } from './src/home.mjs';
import { openDb, memoryApi, readJson } from './src/store.mjs';
import { createDispatcher } from './src/dispatch.mjs';
import { buildToolDefinitions } from './src/tools.mjs';
import { ACTIONS } from './src/catalog.mjs';
import { createMood } from './src/core/mood.mjs';
import { createWakeBudget, createFishGuard } from './src/core/guards.mjs';

export const name = 'moxi';
export const inject = ['tools'];

const DEFAULTS = {
  version: '0.1.0',
  limits: { maxCallsPerDay: 600, maxProactivePerDay: 40, maxBackgroundPerDay: 200 },
  turnGuard: { maxMs: 180000, maxSteps: 6 },
  access: { allow: { private: [], groups: [] }, deny: { private: [], groups: [] }, strictGroups: true },
  gateway: { enabled: false, baseUrl: 'http://127.0.0.1:3004', wsUrl: 'ws://127.0.0.1:3005' },
};

function optional(ctx, name) {
  // 与现有插件一致的取法：优先 ctx.get(name)，再退属性访问
  try { const viaGet = ctx?.get?.(name); if (viaGet !== undefined) return viaGet; } catch { /* 忽略 */ }
  try { return ctx?.[name] ?? null; } catch { return null; }
}

/**
 * 迟到注入的外部服务（例如抖音 bundle 的 `moxiDouyin`）：
 * 每次调用时现查 ctx，这样对方在插件加载之后 provide 也能用。
 */
function lazyService(ctx, name, label) {
  const resolve = () => { try { return ctx?.get?.(name) ?? ctx?.[name] ?? null; } catch { return null; } };
  return {
    get available() { return Boolean(resolve()); },
    async call(action, params = {}) {
      const service = resolve();
      if (!service) throw Object.assign(new Error(label + ' 尚未接入'), { code: 'NOT_CONNECTED' });
      if (typeof service.call === 'function') return service.call(action, params);
      if (typeof service[action] === 'function') return service[action](params);
      throw new Error(label + ' 不支持的动作：' + action);
    },
  };
}

/** ctx.web → 统一服务形状 { call(action, params) } */
function webService(ctx) {
  const web = optional(ctx, 'web');
  if (!web || typeof web.search !== 'function') return null;
  return {
    async call(action, params = {}) {
      const { ok, fail } = await import('./src/output.mjs');
      const tool = action === 'webSearch' ? 'moxi_webSearch' : 'moxi_webFetch';
      if (action === 'webSearch') {
        const result = await web.search({ queries: params.queries ?? (params.query ? [params.query] : []) });
        return ok(tool, { result });
      }
      const result = await web.fetch({ url: params.url });
      return ok(tool, { result });
    },
  };
}

export async function apply(ctx, config = {}, overrides = {}) {
  const dirs = ensureHome(resolveHome(config), DEFAULTS);
  const stored = readConfig(dirs, DEFAULTS);
  const merged = { ...DEFAULTS, ...stored, ...config, gateway: { ...DEFAULTS.gateway, ...(stored.gateway ?? {}), ...(config.gateway ?? {}) } };
  const log = (msg) => { try { ctx?.logger?.info?.(String(msg)); } catch { /* 忽略 */ } };

  const db = openDb(dirs);
  const memory = memoryApi(db);
  const mood = createMood({ dirs, config: merged.mood ?? {} });
  const wakeBudget = createWakeBudget({ dirs, config: merged.wakeBudget ?? {} });
  const fishGuard = createFishGuard({ dirs, cooldownMs: merged.groupCooldownMs ?? undefined });
  const services = {
    gateway: null,      // 阶段 2：OneBot 网关适配器（配置 enabled:true 时创建）
    agent: null,        // 阶段 3：ctx.llm 回合适配器
    douyin: lazyService(ctx, 'moxiDouyin', '抖音 bundle'),   // 阶段 4：由配套抖音插件 provide
    web: webService(ctx),
  };

  if (overrides.gateway) {
    services.gateway = overrides.gateway;   // 测试/嵌入用：直接注入现成网关
  } else if (merged.gateway?.enabled) {
    try {
      const { createGateway } = await import('./src/gateway/index.mjs');
      services.gateway = createGateway({ config: merged, dirs, memory, log, now: () => Date.now() });
      services.gateway.start();
      log('[moxi] QQ 网关已启动：' + merged.gateway.baseUrl);
    } catch (error) {
      log('[moxi] QQ 网关启动失败：' + String(error?.message ?? error));
    }
  }

  // 大脑回合：有 llm 服务就能演练；provider/model 默认跟随 DSH 的默认模型
  try {
    const selection = (() => { try { return ctx?.agentDefaultModel?.currentSelection?.() ?? null; } catch { return null; } })();
    const agentConfig = { ...merged, ...(merged.agent ?? {}), provider: merged.agent?.provider ?? selection?.provider, model: merged.agent?.model ?? selection?.model };
    const { createAgentService } = await import('./src/agent/service.mjs');
    services.agent = createAgentService({
      dirs, config: agentConfig, db, memory, mood, llm: optional(ctx, 'llm'), log, now: () => Date.now(),
      selection: () => {
        // 默认模型选择挂在 agentDefaultModel 服务上；不同版本可能只经 ctx.get 暴露
        const svc = optional(ctx, 'agentDefaultModel');
        const picked = (() => { try { return svc?.currentSelection?.() ?? null; } catch { return null; } })();
        if (picked?.provider && picked?.model) return { provider: picked.provider, model: picked.model };
        return null;
      },
    });
    log('[moxi] 大脑服务：' + (services.agent.available ? `llm 可用（${agentConfig.provider ?? '?'}/${agentConfig.model ?? '?'}）` : '没有 llm 服务（演练不可用）'));
  } catch (error) {
    log('[moxi] 大脑服务初始化失败：' + String(error?.message ?? error));
  }

  // 主动开口：需要网关 + llm + 配置显式打开；定时器交给 ctx.timer（没有就退 setInterval）
  let purposeTimer = null;
  if (merged.purpose?.enabled) {
    if (!services.gateway || !services.agent?.available) {
      log('[moxi] 主动开口已配置但未启用：' + (!services.gateway ? '缺 QQ 网关' : '缺 llm 服务'));
    } else {
      try {
        const { createPurposeLoop } = await import('./src/purpose/loop.mjs');
        const loop = createPurposeLoop({
          dirs, config: merged, memory, mood, agent: services.agent, gateway: services.gateway,
          pause: () => readJson(path.join(dirs.state, 'proactive-pause.json'), { until: 0 }),
          wakeBudget, now: () => Date.now(), log,
        });
        services.purpose = loop;
        const every = Math.max(60_000, Number(merged.purpose.tickMs ?? 300000));
        const tick = () => { loop.tick().catch((error) => log('[purpose] tick 失败：' + String(error?.message ?? error))); };
        if (typeof ctx.timer?.interval === 'function') purposeTimer = ctx.timer.interval(tick, every);
        else { const handle = setInterval(tick, every); purposeTimer = () => clearInterval(handle); }
        log(`[moxi] 主动开口已启用：每 ${Math.round(every / 60000)} 分钟检查一次，目标 ${loop.target()}`);
      } catch (error) {
        log('[moxi] 主动开口初始化失败：' + String(error?.message ?? error));
      }
    }
  }

  const dispatch = createDispatcher({ dirs, config: merged, db, memory, log, now: () => Date.now(), services, mood, wakeBudget, fishGuard, turnGuard: merged.turnGuard });

  const disposers = [];
  try {
    for (const tool of buildToolDefinitions(dispatch, { prefix: merged.tools?.prefix ?? 'moxi', version: merged.version })) {
      disposers.push(ctx.tools.register(tool));
    }
  } catch (error) {
    log('[moxi] 工具注册失败：' + String(error?.message ?? error));
    throw error;
  }

  // 暴露服务，方便其它插件（例如抖音 bundle）读记忆/人格
  const service = {
    version: merged.version,
    home: dirs.home,
    actions: () => ACTIONS.map((a) => a.name),
    memory,
    persona: {
      dir: dirs.persona,
      cardFile: path.join(dirs.persona, 'role-card.md'),
      /** 人格只读：返回卡内容，写入一律拒绝 */
      read() {
        try { return { available: true, text: fs.readFileSync(path.join(dirs.persona, 'role-card.md'), 'utf8') }; }
        catch { return { available: false, text: '' }; }
      },
    },
    pause: () => readJson(path.join(dirs.state, 'proactive-pause.json'), { until: 0 }),
    dispatch,
    // 便于测试与嵌入：暴露内部循环与服务
    services,
    get purpose() { return services.purpose; },
  };
  let provided = false;
  try {
    if (typeof ctx.provide === 'function') { ctx.provide('moxi'); ctx.moxi = service; provided = true; }
    else if (typeof ctx.set === 'function') { ctx.set('moxi', service); provided = true; }
  } catch { /* 服务暴露是增强项，失败不影响工具 */ }

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0).reverse()) { try { dispose?.(); } catch { /* 忽略 */ } }
    try { purposeTimer?.(); } catch { /* 忽略 */ }
    try { services.gateway?.close?.(); } catch { /* 忽略 */ }
    try { db.close(); } catch { /* 忽略 */ }
  });

  log(`[moxi] 已加载：home=${dirs.home} 动作=${ACTIONS.length} 服务=${provided ? 'moxi' : '未暴露'}`);
  // 不要 return service：Cordis 会把插件函数的返回值当成 disposer，返回普通对象会报 "Invalid effect"。
  // 服务已经通过 ctx.provide + ctx.moxi 暴露。
}
