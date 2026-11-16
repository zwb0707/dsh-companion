// observe.mjs —— 事件观察：消息缓存、未读水位、成员活跃度、群缓存
//
// 只存内存 + 少量水位落盘（state/watermarks.json）。不做记忆写入，那由 actions 决定。

import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../store.mjs';

const MAX_MESSAGES_PER_PEER = 200;

export function peerKeyOf(event) {
  const type = event?.message_type ?? (event?.group_id ? 'group' : 'private');
  if (type === 'group') return `group:${event.group_id}`;
  return `private:${event.user_id ?? event.sender?.user_id ?? ''}`;
}

function textOf(segments) {
  if (typeof segments === 'string') return segments;
  if (!Array.isArray(segments)) return '';
  return segments.map((seg) => {
    if (typeof seg === 'string') return seg;
    if (seg?.type === 'text') return seg.data?.text ?? '';
    if (seg?.type === 'at') return `@${seg.data?.qq ?? ''}`;
    if (seg?.type === 'image') return '[图片]';
    if (seg?.type === 'face') return '[表情]';
    if (seg?.type === 'reply') return '[引用]';
    if (seg?.type === 'json' || seg?.type === 'xml') return '[卡片]';
    return `[${seg?.type ?? '未知'}]`;
  }).join('');
}

export function createObservation({ dirs, selfId = '', now = Date.now }) {
  const peers = new Map();   // key → { messages: [], unread: number, seenId: string, lastAt: number }
  const activity = new Map(); // `${group}:${userId}` → { count, lastAt, name }
  const groups = new Map();   // groupId → { id, name, members: Map }
  const watermarkFile = path.join(dirs.state, 'watermarks.json');
  const watermarks = readJson(watermarkFile, {});

  const bucket = (key) => {
    if (!peers.has(key)) peers.set(key, { messages: [], unread: 0, seenId: watermarks[key]?.seenId ?? '', lastAt: 0 });
    return peers.get(key);
  };

  function ingest(event) {
    if (!event || event.post_type !== 'message') return null;
    const key = peerKeyOf(event);
    const entry = bucket(key);
    const id = String(event.message_id ?? '');
    const at = Number(event.time ? event.time * 1000 : now());
    const isSelf = String(event.user_id ?? event.sender?.user_id ?? '') === String(selfId);
    const message = {
      id,
      key,
      at,
      from: String(event.user_id ?? event.sender?.user_id ?? ''),
      name: String(event.sender?.card || event.sender?.nickname || ''),
      text: textOf(event.message ?? event.raw_message),
      role: isSelf ? 'her' : 'user',
      quoted: Array.isArray(event.message) ? (event.message.find((s) => s?.type === 'reply')?.data?.id ?? null) : null,
    };
    entry.messages.push(message);
    if (entry.messages.length > MAX_MESSAGES_PER_PEER) entry.messages.splice(0, entry.messages.length - MAX_MESSAGES_PER_PEER);
    entry.lastAt = at;
    if (!isSelf) entry.unread += 1;

    if (event.message_type === 'group') {
      const groupId = String(event.group_id);
      if (!groups.has(groupId)) groups.set(groupId, { id: groupId, name: '', members: new Map() });
      const group = groups.get(groupId);
      if (!isSelf) {
        const memberKey = `${groupId}:${message.from}`;
        const stat = activity.get(memberKey) ?? { count: 0, lastAt: 0, name: message.name || message.from };
        stat.count += 1;
        stat.lastAt = at;
        stat.name = message.name || stat.name;
        activity.set(memberKey, stat);
        group.members.set(message.from, { id: message.from, name: stat.name, lastAt: at, count: stat.count });
      }
    }
    return message;
  }

  function markSeen(key, throughId) {
    const entry = bucket(key);
    entry.unread = 0;
    entry.seenId = String(throughId ?? entry.messages.at(-1)?.id ?? '');
    watermarks[key] = { seenId: entry.seenId, at: now() };
    try { writeJson(watermarkFile, watermarks); } catch { /* 忽略 */ }
    return { key, seenId: entry.seenId };
  }

  function recent(key, limit = 20) {
    return bucket(key).messages.slice(-Math.min(MAX_MESSAGES_PER_PEER, Math.max(1, Number(limit) || 20)));
  }

  function unread(key) {
    const entry = bucket(key);
    return { key, count: entry.unread, items: entry.messages.filter((m) => m.role !== 'her' && m.id > entry.seenId).slice(-50) };
  }

  function activeMembers(groupId, { limit = 10, windowMs = 6 * 3600_000 } = {}) {
    const since = now() - windowMs;
    return [...activity.entries()]
      .filter(([k]) => k.startsWith(String(groupId) + ':'))
      .map(([, v]) => v)
      .filter((v) => v.lastAt >= since)
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.min(50, Number(limit) || 10));
  }

  function setGroups(list = []) {
    for (const g of list) {
      const id = String(g.group_id ?? g.id);
      const group = groups.get(id) ?? { id, name: '', members: new Map() };
      group.name = String(g.group_name ?? g.name ?? group.name);
      groups.set(id, group);
    }
  }
  function setMembers(groupId, list = []) {
    const id = String(groupId);
    const group = groups.get(id) ?? { id, name: '', members: new Map() };
    for (const m of list) group.members.set(String(m.user_id ?? m.id), { id: String(m.user_id ?? m.id), name: String(m.card || m.nickname || ''), lastAt: 0, count: 0 });
    groups.set(id, group);
  }
  const listGroups = () => [...groups.values()].map((g) => ({ id: g.id, name: g.name, memberCount: g.members.size }));
  const getGroup = (id) => groups.get(String(id)) ?? null;
  const all = () => [...peers.entries()].map(([key, v]) => ({ key, unread: v.unread, lastAt: v.lastAt, messages: v.messages.length }));

  return { ingest, markSeen, recent, unread, activeMembers, setGroups, setMembers, listGroups, getGroup, peers: all, textOf };
}

export { textOf };
