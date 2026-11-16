// gateway.test.mjs —— 用假 transport 验证 18 个网关动作，不碰真网络
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGateway } from '../src/gateway/index.mjs';
import { openDb, memoryApi } from '../src/store.mjs';
import { resolveHome, ensureHome } from '../src/home.mjs';

function setup({ allow = { private: ['10001'], groups: ['800000000'] }, send = { maxSendPerMinute: 20, maxSendPerHour: 300, intervalMinMs: 1, intervalMaxMs: 2 }, history = { enabled: false } } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-moxi-gw-'));
  const dirs = ensureHome(resolveHome({ home }), {});
  const db = openDb(dirs);
  const memory = memoryApi(db);
  const calls = [];
  const responses = new Map();
  const listeners = [];
  const transport = {
    async httpCall(action, body) {
      calls.push({ action, body });
      const handler = responses.get(action);
      if (typeof handler === 'function') return handler(body);
      if (handler) return handler;
      return { ok: true, data: null };
    },
    connect({ onEvent }) { listeners.push(onEvent); return { close() {}, connected: true }; },
  };
  const config = {
    access: { allow, deny: { private: [], groups: [] }, strictGroups: true },
    send,
    history,
    gateway: { enabled: true, baseUrl: 'http://fake', wsUrl: 'ws://fake' },
  };
  const gateway = createGateway({ config, dirs, memory, log: () => {}, transport });
  gateway.start();
  const emit = (event) => listeners.forEach((fn) => fn(event));
  return { home, dirs, db, memory, gateway, calls, responses, emit };
}

const groupMessage = (text, userId = '20002', groupId = 800000000, id = String(Math.random())) => ({
  post_type: 'message', message_type: 'group', group_id: groupId, user_id: Number(userId),
  sender: { user_id: Number(userId), nickname: '群友' }, message: [{ type: 'text', data: { text } }],
  message_id: id, time: Math.floor(Date.now() / 1000),
});

test('groups 读网关群列表', async () => {
  const { gateway, responses } = setup();
  responses.set('get_group_list', { ok: true, data: [{ group_id: 800000000, group_name: '测试群' }] });
  const out = await gateway.call('groups', {});
  assert.equal(out.result.ok, true);
  assert.equal(out.result.groups[0].id, '800000000');
  assert.equal(out.result.groups[0].name, '测试群');
});

test('send 到许可会话：调 send_private_msg 并落流水', async () => {
  const { gateway, calls, memory } = setup();
  const out = await gateway.call('send', { key: 'private:10001', text: '你好' });
  assert.equal(out.result.ok, true);
  const sent = calls.find((c) => c.action === 'send_private_msg');
  assert.equal(sent.body.user_id, 10001);
  assert.equal(sent.body.message, '你好');
  assert.equal(memory.recentTurns({ peer: 'private:10001' }).length, 1);
});

test('send 到名单外会话直接拒绝', async () => {
  const { gateway, calls } = setup();
  await assert.rejects(() => gateway.call('send', { key: 'private:99999', text: 'x' }), /许可名单/);
  assert.equal(calls.filter((c) => c.action === 'send_private_msg').length, 0);
});

test('burst 依次发多条', async () => {
  const { gateway, calls } = setup();
  const out = await gateway.call('burst', { key: 'private:10001', messages: ['一', '二'] });
  assert.equal(out.result.ok, true);
  assert.equal(calls.filter((c) => c.action === 'send_private_msg').length, 2);
});

test('发送限速生效', async () => {
  const { gateway } = setup({ send: { maxSendPerMinute: 2, maxSendPerHour: 300, intervalMinMs: 1, intervalMaxMs: 2 } });
  await gateway.call('send', { key: 'private:10001', text: 'a' });
  await gateway.call('send', { key: 'private:10001', text: 'b' });
  await assert.rejects(() => gateway.call('send', { key: 'private:10001', text: 'c' }), /限速/);
});

test('连续三次失败后进入暂停', async () => {
  const { gateway, responses } = setup();
  responses.set('send_private_msg', { ok: false, error: 'boom' });
  for (let i = 0; i < 3; i++) await assert.rejects(() => gateway.call('send', { key: 'private:10001', text: 'x' }));
  await assert.rejects(() => gateway.call('send', { key: 'private:10001', text: 'y' }), /暂停/);
});

test('观察：未读、已读水位、活跃成员', async () => {
  const { gateway, emit } = setup();
  emit(groupMessage('第一句', '20002'));
  emit(groupMessage('第二句', '20003'));
  const unread = await gateway.call('unread', { key: 'group:800000000' });
  assert.equal(unread.result.count, 2);
  await gateway.call('markRead', { key: 'group:800000000' });
  const after = await gateway.call('unread', { key: 'group:800000000' });
  assert.equal(after.result.count, 0);
  const active = await gateway.call('activeMembers', { group: '800000000' });
  assert.equal(active.result.ok, true);
  assert.equal(active.result.observed.length, 2);
});

test('wait 在新消息到达时返回', async () => {
  const { gateway, emit } = setup();
  const pending = gateway.call('wait', { key: 'group:800000000', timeoutMs: 2000 });
  setTimeout(() => emit(groupMessage('来了')), 20);
  const out = await pending;
  assert.equal(out.result.ok, true);
  assert.equal(out.result.text, '来了');
});

test('catchup 在 history.enabled=false 时不拉历史', async () => {
  const { gateway, calls } = setup({ history: { enabled: false } });
  const out = await gateway.call('catchup', {});
  assert.equal(out.result.skipped, true);
  assert.equal(calls.filter((c) => c.action.includes('history')).length, 0);
});

test('catchup 打开后会写入观察缓存', async () => {
  const { gateway, responses } = setup({ history: { enabled: true, limit: 10 } });
  responses.set('get_friend_msg_history', { ok: true, data: { messages: [{ message_id: 'm1', sender: { user_id: 10001, nickname: '主人' }, message: [{ type: 'text', data: { text: '昨天的话' } }], time: Math.floor(Date.now() / 1000) }] } });
  const out = await gateway.call('catchup', {});
  assert.equal(out.result.ok, true);
  const recent = await gateway.call('recent', { key: 'private:10001' });
  assert.equal(recent.result.items.length, 1);
  assert.equal(recent.result.items[0].text, '昨天的话');
});
