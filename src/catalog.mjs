// catalog.mjs —— 动作单一清单：49 个运行时动作 + capabilities + docs（共 51 个工具）
//
// 这份清单是插件对外的能力目录：tools.mjs 用它生成工具，dispatch.mjs 用它决定落哪个 handler，
// moxi_capabilities 工具直接返回它。以后加动作只改这里。

/** 需要什么才能跑：local=纯本地；gateway=QQ 网关；agent=她的大脑回合；douyin=抖音 bundle；web=联网 */
export const ACTIONS = [
  // ── 纯本地 ────────────────────────────────────────────────
  { name: 'status', summary: '总状态：运行位置、记忆条数、额度、暂停、模式。', needs: 'local' },
  { name: 'health', summary: '自检：数据目录、记忆库、网关、额度、服务接线情况。', needs: 'local' },
  { name: 'capabilities', summary: '列出全部可用动作及其中文说明。', needs: 'local' },
  { name: 'docs', summary: '读取插件自带文档（说明/工具规约），可只列清单。', needs: 'local', params: { name: { type: 'string', description: 'detail = 插件说明；rules = 工具使用规约；省略 = 两份都返回。' }, listOnly: { type: 'boolean', description: 'true 时只返回清单。' } } },
  { name: 'memory', summary: '记忆库操作：op=query|list|add|update|delete|pin（改删前先 query 核对 id）。', needs: 'local', mutating: true, params: { op: { type: 'string', description: 'query|list|add|update|delete|pin' }, query: { type: 'string' }, kind: { type: 'string', description: 'event|fact|feeling|pending' }, id: { type: 'number' }, content: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' }, pinned: { type: 'boolean' } } },
  { name: 'learn', summary: '写一条她自己的经历/事实进记忆。', needs: 'local', mutating: true, params: { content: { type: 'string' }, kind: { type: 'string' }, source: { type: 'string' } } },
  { name: 'commitments', summary: '约定：op=add|list|done。', needs: 'local', mutating: true, params: { op: { type: 'string' }, text: { type: 'string' }, id: { type: 'number' }, note: { type: 'string' } } },
  { name: 'slang', summary: '群黑话：query 查询 / submit 提交陌生词。', needs: 'local', mutating: true, params: { op: { type: 'string', description: 'query|submit' }, q: { type: 'string' }, content: { type: 'string' }, context: { type: 'string' } } },
  { name: 'audit', summary: '读取近期操作审计。', needs: 'local', params: { limit: { type: 'number' } } },
  { name: 'logs', summary: '检索日志尾部（按关键词/条数）。', needs: 'local', params: { query: { type: 'string' }, lines: { type: 'number' } } },
  { name: 'billing', summary: '读取今日与近 7 天调用次数与估算花费。', needs: 'local', params: { days: { type: 'number' } } },
  { name: 'guards', summary: '护栏状态：发送冷却、唤醒额度、回合状态。', needs: 'local' },
  { name: 'pause', summary: '暂停主动消息 N 小时（hours=0 表示恢复）。', needs: 'local', mutating: true, params: { hours: { type: 'number' } } },
  { name: 'pauseStatus', summary: '读取是否暂停、何时恢复。', needs: 'local' },
  { name: 'mode', summary: '运行模式与静默开关：读取或设置。', needs: 'local', mutating: true, params: { mode: { type: 'string' }, silent: { type: 'boolean' } } },
  { name: 'rhythm', summary: '作息/节律：按小时统计的群活跃度。', needs: 'local' },
  { name: 'groupTick', summary: '群节拍：单个群的活跃窗口。', needs: 'local', params: { group: { type: 'string' } } },
  { name: 'socialState', summary: '社交状态：许可名单、好友/群关系。', needs: 'local' },
  { name: 'stickers', summary: '已收藏的表情列表（可按情绪/内容过滤）。', needs: 'local', params: { query: { type: 'string' }, refresh: { type: 'boolean' } } },
  { name: 'faces', summary: '表情收藏的增删查。', needs: 'local', mutating: true, params: { op: { type: 'string' }, id: { type: 'string' }, emotion: { type: 'string' }, content: { type: 'string' } } },
  { name: 'stickerImage', summary: '取某个收藏表情的图片。', needs: 'local', params: { stickerId: { type: 'string' } } },
  { name: 'selfImage', summary: '取她自己的形象图。', needs: 'local' },
  { name: 'clearOutbox', summary: '清空待发队列（丢弃尚未发出的消息）。', needs: 'local', mutating: true },
  { name: 'myRecent', summary: '她最近主动说出的话。', needs: 'local', params: { limit: { type: 'number' } } },
  { name: 'stickerCollect', summary: '收藏某条消息里的表情（需要消息 id）。', needs: 'gateway', mutating: true, params: { key: { type: 'string' }, messageId: { type: 'string' }, emotion: { type: 'string' }, content: { type: 'string' }, remark: { type: 'string' } } },

  // ── 需要 QQ 网关 ──────────────────────────────────────────
  { name: 'groups', summary: '她所在的 QQ 群列表。', needs: 'gateway' },
  { name: 'activeMembers', summary: '群里最近活跃的成员。', needs: 'gateway', params: { group: { type: 'string' } } },
  { name: 'recent', summary: '会话最近消息（默认主人私聊）。', needs: 'gateway', params: { key: { type: 'string' }, limit: { type: 'number' } } },
  { name: 'unread', summary: '读取未读消息。', needs: 'gateway', params: { key: { type: 'string' } } },
  { name: 'context', summary: '会话上下文快照：未读+最近+社交+活跃成员。', needs: 'gateway', params: { key: { type: 'string' } } },
  { name: 'messageDetail', summary: '单条消息详情（发送者/正文/引用/媒体）。', needs: 'gateway', params: { key: { type: 'string' }, messageId: { type: 'string' } } },
  { name: 'media', summary: '媒体信息与转发。', needs: 'gateway', mutating: true, params: { key: { type: 'string' }, messageId: { type: 'string' }, op: { type: 'string' } } },
  { name: 'mark-read', summary: '把会话标为已读（可带水位）。', needs: 'gateway', mutating: true, params: { key: { type: 'string' }, throughSeq: { type: 'number' } } },
  { name: 'wait', summary: '等新消息（带超时，别当轮询）。', needs: 'gateway', params: { key: { type: 'string' }, timeoutMs: { type: 'number' }, quietMs: { type: 'number' } } },
  { name: 'catchup', summary: '补读积压消息。', needs: 'gateway', params: { reconnect: { type: 'boolean' } } },
  { name: 'send', summary: '发一条文本到指定会话（key=private:<qq> / group:<群号>）。', needs: 'gateway', mutating: true, outbound: true, params: { key: { type: 'string' }, text: { type: 'string' } } },
  { name: 'burst', summary: '拆多条依次发出（拟真连发）。', needs: 'gateway', mutating: true, outbound: true, params: { key: { type: 'string' }, messages: { type: 'array', items: { type: 'string' } } } },
  { name: 'sendImage', summary: '发图片（文件需已在本机）。', needs: 'gateway', mutating: true, outbound: true, params: { key: { type: 'string' }, path: { type: 'string' } } },
  { name: 'forward', summary: '转发消息（单条或合并）。', needs: 'gateway', mutating: true, outbound: true, params: { key: { type: 'string' }, messageId: { type: 'string' }, targets: { type: 'array', items: { type: 'string' } } } },
  { name: 'poke', summary: '拍一拍（群聊需 targetUserId）。', needs: 'gateway', mutating: true, outbound: true, params: { key: { type: 'string' }, targetUserId: { type: 'string' } } },
  { name: 'react', summary: '对消息做表情回应。', needs: 'gateway', mutating: true, outbound: true, params: { key: { type: 'string' }, messageId: { type: 'string' }, emoji: { type: 'string' } } },
  { name: 'mediaShare', summary: '主动分享视频（受每日上限/间隔限制）。', needs: 'gateway', mutating: true, outbound: true, params: { url: { type: 'string' }, to: { type: 'string' } } },

  // ── 需要她的大脑回合（agent）──────────────────────────────
  { name: 'simulate', summary: '演练：不真发，只返回她会怎么回。', needs: 'agent', params: { text: { type: 'string' }, key: { type: 'string' } } },
  { name: 'report', summary: '生成今日 Markdown 日报。', needs: 'agent' },
  { name: 'purposeMaterials', summary: '生成主动搭话素材（她为什么开口）。', needs: 'agent' },
  { name: 'wake', summary: '设置下次唤醒条件。', needs: 'agent', mutating: true, params: { key: { type: 'string' }, config: { type: 'object', additionalProperties: true } } },
  { name: 'close', summary: '结束当前对话并留下结束点。', needs: 'agent', mutating: true, params: { key: { type: 'string' }, summary: { type: 'string' }, nextOpening: { type: 'string' }, reason: { type: 'string' } } },

  // ── 需要抖音 bundle ──────────────────────────────────────
  { name: 'douyin', summary: '抖音总入口：读状态(plugin) / 执行动作(action{path,body}) / 最近观看(recent)。', needs: 'douyin', mutating: true, params: { plugin: { type: 'boolean' }, action: { type: 'object', additionalProperties: true }, recent: { type: 'number' } } },
  { name: 'douyinAccount', summary: '抖音账号与主人账号绑定信息。', needs: 'douyin' },

  // ── 需要联网服务 ─────────────────────────────────────────
  { name: 'webSearch', summary: '联网搜索（只读）。', needs: 'web', params: { query: { type: 'string' }, queries: { type: 'array', items: { type: 'string' } } } },
  { name: 'webFetch', summary: '抓取网页正文（只读）。', needs: 'web', params: { url: { type: 'string' } } },
];

export const BY_NAME = new Map(ACTIONS.map((a) => [a.name, a]));

/** 动作名 → 工具名（驼峰/连字符 → 小写蛇形） */
export function toolName(action, prefix = 'moxi') {
  const snake = String(action)
    .replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
    .replace(/-/g, '_')
    .replace(/^_+/, '');
  return `${prefix}_${snake}`;
}

export const NEEDS_HELP = {
  gateway: '未连接 QQ 网关：在插件配置 gateway.baseUrl/wsUrl 填好 OneBot 地址并 enabled:true。',
  agent: '未接入大脑回合：需要 DSH agent 服务（ctx.agentLoop/subagents）才能生成她的回复。',
  douyin: '未安装抖音 bundle：本插件的 douyin 动作只是转发入口，需要配套的抖音插件。',
  web: '未接入联网服务：当前 profile 没有 ctx.web。',
};
