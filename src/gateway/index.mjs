// gateway/index.mjs —— 把 OneBot 传输、观察、动作组装成一个 service { call(action, params) }
import { createOneBotTransport } from './onebot.mjs';
import { createObservation } from './observe.mjs';
import { createGatewayActions } from './actions.mjs';

export function createBus() {
  const listeners = new Set();
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(message) { for (const fn of [...listeners]) { try { fn(message); } catch { /* 忽略 */ } } },
  };
}

export function createGateway({ config, dirs, memory, log = () => {}, now = Date.now, transport: injected }) {
  const gatewayConfig = config.gateway ?? {};
  const transport = injected ?? createOneBotTransport({
    baseUrl: gatewayConfig.baseUrl,
    wsUrl: gatewayConfig.wsUrl,
    token: gatewayConfig.token ?? '',
    log,
  });
  const observe = createObservation({ dirs, selfId: gatewayConfig.selfId ?? '', now });
  const bus = createBus();
  const actions = createGatewayActions({ transport, observe, memory, config, dirs, log, now, bus });

  let connection = null;
  let closed = false;

  async function refreshGroups() {
    try {
      const res = await transport.httpCall('get_group_list', {});
      if (res.ok && Array.isArray(res.data)) observe.setGroups(res.data);
    } catch (error) { log('[gateway] 读群列表失败：' + String(error?.message ?? error)); }
  }

  function start() {
    if (closed) return;
    if (typeof transport.connect !== 'function') return;
    connection = transport.connect({
      onEvent(event) {
        const message = observe.ingest(event);
        if (message) bus.emit(message);
      },
      onOpen() { void refreshGroups(); },
    });
    void refreshGroups();
  }

  async function call(action, params = {}) {
    const handler = actions.handlers[action];
    if (!handler) throw new Error('网关不支持的动作：' + action);
    return handler(params ?? {});
  }

  function close() {
    closed = true;
    try { connection?.close(); } catch { /* 忽略 */ }
  }

  return {
    start,
    call,
    close,
    bus,
    observe,
    state: () => ({
      connected: Boolean(connection?.connected),
      groups: observe.listGroups(),
      peers: observe.peers(),
    }),
  };
}
