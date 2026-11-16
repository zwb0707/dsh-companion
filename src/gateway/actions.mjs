// actions.mjs —— 需要 QQ 网关的 18 个动作（进程内实现，走 OneBot HTTP + 本地观察）
import fs from 'node:fs';
import path from 'node:path';
import { ok, fail } from '../output.mjs';
import { readJson, writeJson, appendJsonl, readJsonlTail } from '../store.mjs';
import { textOf } from './observe.mjs';

const OUTBOUND = new Set(['send', 'burst', 'sendImage', 'forward', 'poke', 'react', 'mediaShare']);

export function createGatewayActions({ transport, observe, memory, config, dirs, log = () => {}, now = Date.now, bus }) {
  const sendStateFile = path.join(dirs.data, 'send-guard.json');
  const auditFile = path.join(dirs.data, 'audit.jsonl');
  const stickersFile = path.join(dirs.data, 'stickers.json');
  const sends = [];   // 发送时间戳，用于限速

  const audit = (action, detail) => { try { appendJsonl(auditFile, { at: now(), action, ...detail }); } catch { /* 忽略 */ } };

  function parseKey(key) {
    const raw = String(key ?? '');
    const m = /^(private|group):(.+)$/.exec(raw);
    if (!m) throw new Error('key 必须是 private:<qq> 或 group:<群号>');
    return { kind: m[1], id: m[2] };
  }

  function assertAllowed(key) {
    const access = config.access ?? {};
    const allow = access.allow ?? { private: [], groups: [] };
    const { kind, id } = parseKey(key);
    const list = kind === 'private' ? (allow.private ?? []) : (allow.groups ?? []);
    if (list.length && !list.map(String).includes(String(id))) throw new Error(`未在许可名单里的会话：${key}（先在配置 access.allow 里加）`);
    return { kind, id };
  }

  function rateGuard() {
    const maxMinute = Number(config.send?.maxSendPerMinute ?? 20);
    const maxHour = Number(config.send?.maxSendPerHour ?? 300);
    const t = now();
    while (sends.length && t - sends[0] > 3600_000) sends.shift();
    const lastMinute = sends.filter((x) => t - x <= 60_000).length;
    if (lastMinute >= maxMinute) throw new Error(`触发发送限速：每分钟最多 ${maxMinute} 条`);
    if (sends.length >= maxHour) throw new Error(`触发发送限速：每小时最多 ${maxHour} 条`);
  }

  function guardState() { return readJson(sendStateFile, {}); }
  function guardCheck(key) {
    const entry = guardState()[key] ?? {};
    if (Number(entry.pausedUntil) > now()) throw new Error(`${key} 连续发送失败，已暂停到 ${new Date(Number(entry.pausedUntil)).toISOString()}`);
  }
  function guardRecord(key, okFlag, error) {
    const state = guardState();
    const entry = state[key] ?? { streak: 0, pausedUntil: 0, lastError: '' };
    if (okFlag) { entry.streak = 0; entry.pausedUntil = 0; entry.lastError = ''; }
    else {
      entry.streak = Number(entry.streak ?? 0) + 1;
      entry.lastError = String(error ?? '').slice(0, 200);
      if (entry.streak >= 3) entry.pausedUntil = now() + 30 * 60_000;
    }
    entry.lastAt = now();
    state[key] = entry;
    try { writeJson(sendStateFile, state); } catch { /* 忽略 */ }
  }

  async function sendText(key, text) {
    const { kind, id } = assertAllowed(key);
    const body = kind === 'private' ? { user_id: Number(id), message: String(text) } : { group_id: Number(id), message: String(text) };
    guardCheck(key); rateGuard();
    const res = await transport.httpCall(kind === 'private' ? 'send_private_msg' : 'send_group_msg', body);
    guardRecord(key, res.ok, res.error);
    if (!res.ok) throw new Error(res.error);
    sends.push(now());
    memory.logTurn({ platform: 'qq', peer: key, role: 'her', content: String(text), at: now() });
    audit('send', { key, chars: String(text).length });
    return { key, messageId: res.data?.message_id ?? null };
  }

  const handlers = {
    async groups() {
      const res = await transport.httpCall('get_group_list', {});
      if (res.ok && Array.isArray(res.data)) { observe.setGroups(res.data); return ok('moxi_groups', { groups: observe.listGroups() }); }
      const cached = observe.listGroups();
      if (cached.length) return ok('moxi_groups', { groups: cached, stale: true, error: res.error });
      throw new Error(res.error ?? '读不到群列表');
    },

    async activeMembers({ group, limit = 10 } = {}) {
      const groups = observe.listGroups();
      const groupId = String(group ?? groups[0]?.id ?? '');
      if (!groupId) throw new Error('还没有已知的群：先调 moxi_groups');
      let members = [];
      try {
        const res = await transport.httpCall('get_group_member_list', { group_id: Number(groupId) });
        if (res.ok && Array.isArray(res.data)) { observe.setMembers(groupId, res.data); members = res.data; }
      } catch { /* 用观察数据 */ }
      return ok('moxi_activeMembers', { group: groupId, observed: observe.activeMembers(groupId, { limit }), memberCount: members.length || observe.getGroup(groupId)?.members.size || 0 });
    },

    async recent({ key, limit = 20 } = {}) {
      if (key) {
        assertAllowed(key);
        return ok('moxi_recent', { key, items: observe.recent(key, limit) });
      }
      return ok('moxi_recent', { peers: observe.peers() });
    },

    async unread({ key } = {}) {
      if (key) return ok('moxi_unread', observe.unread(key));
      return ok('moxi_unread', { peers: observe.peers().filter((p) => p.unread > 0) });
    },

    async context({ key } = {}) {
      const target = key ?? (config.access?.allow?.private?.[0] ? `private:${config.access.allow.private[0]}` : '');
      if (!target) throw new Error('需要 key（private:<qq> 或 group:<群号>）');
      const parsed = parseKey(target);
      return ok('moxi_context', {
        key: target,
        unread: observe.unread(target),
        recent: observe.recent(target, 20),
        activeMembers: parsed.kind === 'group' ? observe.activeMembers(parsed.id) : [],
        social: config.access ?? {},
      });
    },

    async messageDetail({ key, messageId } = {}) {
      if (!messageId) throw new Error('需要 messageId');
      const hit = key ? observe.recent(key, 200).find((m) => String(m.id) === String(messageId)) : null;
      if (hit) return ok('moxi_messageDetail', { message: hit, source: 'cache' });
      const res = await transport.httpCall('get_msg', { message_id: Number(messageId) });
      if (!res.ok) throw new Error(res.error);
      const data = res.data ?? {};
      return ok('moxi_messageDetail', {
        source: 'gateway',
        message: { id: String(data.message_id ?? messageId), from: String(data.sender?.user_id ?? ''), name: String(data.sender?.card || data.sender?.nickname || ''), text: textOf(data.message), at: Number(data.time ?? 0) * 1000 },
      });
    },

    async media({ key, messageId, op = 'info' } = {}) {
      if (!messageId) throw new Error('需要 messageId');
      const res = await transport.httpCall('get_msg', { message_id: Number(messageId) });
      if (!res.ok) throw new Error(res.error);
      const segments = Array.isArray(res.data?.message) ? res.data.message : [];
      const media = segments.filter((s) => ['image', 'video', 'record', 'file'].includes(s?.type))
        .map((s) => ({ type: s.type, file: s.data?.file ?? '', url: s.data?.url ?? '', name: s.data?.name ?? '' }));
      if (op === 'forward' && key) return handlers.forward({ key, messageId });
      return ok('moxi_media', { messageId, count: media.length, media });
    },

    async markRead({ key, throughSeq } = {}) {
      const target = key ?? (config.access?.allow?.private?.[0] ? `private:${config.access.allow.private[0]}` : '');
      if (!target) throw new Error('需要 key');
      return ok('moxi_mark_read', observe.markSeen(target, throughSeq));
    },

    async wait({ key, timeoutMs = 30000, quietMs = 0 } = {}) {
      const budget = Math.min(600000, Math.max(1000, Number(timeoutMs) || 30000));
      const quiet = Math.max(0, Number(quietMs) || 0);
      return new Promise((resolve) => {
        let timer; let quietTimer;
        const finish = (payload) => { clearTimeout(timer); clearTimeout(quietTimer); unsubscribe(); resolve(payload); };
        const unsubscribe = bus.subscribe((message) => {
          if (key && message.key !== key) return;
          const settle = () => finish(ok('moxi_wait', { key: key ?? message.key, message, text: message.text }));
          if (quiet > 0) { clearTimeout(quietTimer); quietTimer = setTimeout(settle, quiet); } else settle();
        });
        timer = setTimeout(() => finish(ok('moxi_wait', { key: key ?? '', timeout: true, reason: `等待 ${Math.round(budget / 1000)} 秒没有新消息` })), budget);
      });
    },

    async catchup({ reconnect = false } = {}) {
      if (config.history?.enabled !== true) {
        return ok('moxi_catchup', { skipped: true, reason: 'history.enabled=false：不主动拉历史' });
      }
      const limit = Number(config.history?.limit ?? 30);
      const targets = [
        ...(config.access?.allow?.groups ?? []).map((id) => ({ kind: 'group', id: String(id) })),
        ...(config.access?.allow?.private ?? []).map((id) => ({ kind: 'private', id: String(id) })),
      ];
      const results = [];
      for (const target of targets) {
        const action = target.kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history';
        const body = target.kind === 'group' ? { group_id: Number(target.id), count: limit } : { user_id: Number(target.id), count: limit };
        const res = await transport.httpCall(action, body);
        if (!res.ok) { results.push({ target, ok: false, error: res.error }); continue; }
        const list = Array.isArray(res.data?.messages) ? res.data.messages : [];
        let added = 0;
        for (const msg of list) {
          const message = observe.ingest({ post_type: 'message', message_type: target.kind, group_id: target.kind === 'group' ? Number(target.id) : undefined, user_id: msg.sender?.user_id, sender: msg.sender, message: msg.message, message_id: msg.message_id, time: msg.time });
          if (message) added += 1;
        }
        results.push({ target, ok: true, added });
      }
      return ok('moxi_catchup', { reconnect: Boolean(reconnect), results });
    },

    async send({ key, text } = {}) {
      if (!text) throw new Error('text 不能为空');
      return ok('moxi_send', await sendText(key, text));
    },

    async burst({ key, messages } = {}) {
      const list = Array.isArray(messages) ? messages : (messages ? [messages] : []);
      if (!list.length) throw new Error('messages 不能为空');
      if (list.length > 8) throw new Error('一次最多 8 条');
      const sent = [];
      for (const [index, text] of list.entries()) {
        if (index > 0) {
          const min = Number(config.send?.intervalMinMs ?? 900);
          const max = Math.max(min, Number(config.send?.intervalMaxMs ?? 2600));
          await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
        }
        sent.push(await sendText(key, text));
      }
      return ok('moxi_burst', { sent });
    },

    async sendImage({ key, path: filePath } = {}) {
      const { kind, id } = assertAllowed(key);
      if (!filePath || !fs.existsSync(filePath)) throw new Error('图片不存在：' + filePath);
      const file = 'file:///' + String(filePath).replace(/\\/g, '/');
      guardCheck(key); rateGuard();
      const body = kind === 'private'
        ? { user_id: Number(id), message: [{ type: 'image', data: { file } }] }
        : { group_id: Number(id), message: [{ type: 'image', data: { file } }] };
      const res = await transport.httpCall(kind === 'private' ? 'send_private_msg' : 'send_group_msg', body);
      guardRecord(key, res.ok, res.error);
      if (!res.ok) throw new Error(res.error);
      sends.push(now());
      audit('sendImage', { key, file: filePath });
      return ok('moxi_sendImage', { key, messageId: res.data?.message_id ?? null });
    },

    async forward({ key, messageId, targets } = {}) {
      const list = Array.isArray(targets) && targets.length ? targets : (key ? [key] : []);
      if (!list.length) throw new Error('需要 key 或 targets');
      const done = [];
      for (const target of list) {
        const { kind, id } = assertAllowed(target);
        const action = kind === 'private' ? 'forward_friend_single_msg' : 'forward_group_single_msg';
        const body = kind === 'private' ? { user_id: Number(id), message_id: Number(messageId) } : { group_id: Number(id), message_id: Number(messageId) };
        const res = await transport.httpCall(action, body);
        done.push({ target, ok: res.ok, messageId: res.data?.message_id ?? null, error: res.ok ? undefined : res.error });
      }
      const bad = done.filter((d) => !d.ok);
      if (bad.length === done.length) throw new Error(bad[0].error ?? '转发失败');
      audit('forward', { messageId, targets: list });
      return ok('moxi_forward', { done });
    },

    async poke({ key, targetUserId } = {}) {
      const { kind, id } = assertAllowed(key);
      if (kind === 'group' && !targetUserId) throw new Error('群聊拍一拍需要 targetUserId');
      const action = kind === 'private' ? 'friend_poke' : 'group_poke';
      const body = kind === 'private' ? { user_id: Number(id) } : { group_id: Number(id), user_id: Number(targetUserId) };
      const res = await transport.httpCall(action, body);
      if (!res.ok) throw new Error(res.error);
      audit('poke', { key, targetUserId: targetUserId ?? null });
      return ok('moxi_poke', { key, target: targetUserId ?? null });
    },

    async react({ key, messageId, emoji } = {}) {
      if (!messageId) throw new Error('需要 messageId');
      const res = await transport.httpCall('set_msg_emoji_like', { message_id: Number(messageId), emoji_id: String(emoji ?? '128077') });
      if (!res.ok) {
        return fail('moxi_react', '当前 OneBot 实现不支持表情回应：' + res.error);
      }
      audit('react', { key, messageId, emoji });
      return ok('moxi_react', { messageId, emoji: emoji ?? '128077' });
    },

    async mediaShare({ url, to } = {}) {
      if (!url) throw new Error('需要 url');
      const target = to ?? (config.access?.allow?.private?.[0] ? `private:${config.access.allow.private[0]}` : '');
      if (!target) throw new Error('需要 to（会话 key）');
      const { kind, id } = assertAllowed(target);
      const payload = { app: 'com.tencent.structmsg', desc: '新闻', view: 'news', prompt: '分享一个视频', meta: { news: { jumpUrl: url, preview: url, title: url, desc: '分享的视频' } } };
      const body = kind === 'private'
        ? { user_id: Number(id), message: [{ type: 'json', data: { data: JSON.stringify(payload) } }] }
        : { group_id: Number(id), message: [{ type: 'json', data: { data: JSON.stringify(payload) } }] };
      const res = await transport.httpCall(kind === 'private' ? 'send_private_msg' : 'send_group_msg', body);
      if (!res.ok) {
        const fallback = await sendText(target, url);
        return ok('moxi_mediaShare', { fallback: 'card-unsupported', ...fallback });
      }
      audit('mediaShare', { target, url });
      return ok('moxi_mediaShare', { target, messageId: res.data?.message_id ?? null });
    },

    async stickerCollect({ key, messageId, emotion = '', content = '', remark = '' } = {}) {
      if (!messageId) throw new Error('需要 messageId');
      const res = await transport.httpCall('get_msg', { message_id: Number(messageId) });
      if (!res.ok) throw new Error(res.error);
      const segments = Array.isArray(res.data?.message) ? res.data.message : [];
      const sticker = segments.find((s) => ['face', 'image', 'mface'].includes(s?.type));
      if (!sticker) throw new Error('这条消息里没有表情或图片');
      const store = readJson(stickersFile, { items: [] });
      const item = { id: `stk-${messageId}`, key, path: sticker.data?.file ?? '', url: sticker.data?.url ?? '', emotion, content, remark, addedAt: now() };
      store.items = [...(store.items ?? []), item];
      writeJson(stickersFile, store);
      return ok('moxi_stickerCollect', { item, count: store.items.length });
    },
  };

  return {
    handlers,
    OUTBOUND,
    history: () => readJsonlTail(auditFile, 20),
  };
}
