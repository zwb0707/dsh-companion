// onebot.mjs —— OneBot 11 传输层（HTTP 调用 + WS 事件流）
//
// 只用 Node 内建能力：fetch + 全局 WebSocket（Node ≥22）。没有第三方依赖。
// 测试时可注入 transport，不碰真网络。

export function createOneBotTransport({ baseUrl, wsUrl, token = '', log = () => {}, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, timeoutMs = 30000 }) {
  if (!baseUrl) throw new Error('gateway.baseUrl 未配置');

  const headers = () => ({
    'content-type': 'application/json; charset=utf-8',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

  async function httpCall(action, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/${action}`, {
        method: 'POST', headers: headers(), body: JSON.stringify(body ?? {}), signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      const status = String(json?.status ?? '').toLowerCase();
      const retcode = Number.isFinite(json?.retcode) ? json.retcode : null;
      const failed = !res.ok || status === 'failed' || (status !== '' && status !== 'ok' && status !== 'async')
        || (retcode !== null && retcode !== 0 && retcode !== 1);
      if (failed) return { ok: false, error: json?.message || json?.wording || `HTTP ${res.status}`, raw: json };
      return { ok: true, async: status === 'async' || retcode === 1, data: json?.data ?? null };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    } finally { clearTimeout(timer); }
  }

  let socket = null;
  let closedByUs = false;

  function connect({ onEvent, onOpen, onClose } = {}) {
    if (typeof WebSocketImpl !== 'function') throw new Error('当前 Node 没有全局 WebSocket');
    const url = new URL(wsUrl || baseUrl.replace(/^http/, 'ws'));
    if (token) url.searchParams.set('access_token', token);
    let attempt = 0;
    const open = () => {
      socket = new WebSocketImpl(url.toString());
      socket.addEventListener('open', () => { attempt = 0; onOpen?.(); log('[gateway] WS 已连接'); });
      socket.addEventListener('message', (event) => {
        let payload;
        try { payload = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch { return; }
        onEvent?.(payload);
      });
      socket.addEventListener('close', () => {
        socket = null;
        onClose?.();
        if (closedByUs) return;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5));
        log(`[gateway] WS 断开，${Math.round(delay / 1000)}s 后重连`);
        setTimeout(open, delay).unref?.();
      });
      socket.addEventListener('error', () => { /* close 事件会处理重连 */ });
    };
    open();
    return {
      close() { closedByUs = true; try { socket?.close(); } catch { /* 忽略 */ } },
      get connected() { return Boolean(socket && socket.readyState === 1); },
    };
  }

  return { httpCall, connect };
}
