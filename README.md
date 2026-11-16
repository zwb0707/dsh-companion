# 墨汐人格运行时（dsh-moxi）

![ci](https://github.com/zwb0707/dsh-companion/actions/workflows/ci.yml/badge.svg)

把「她」跑起来的本地底座：记忆、心情、护栏、主动开口，以及 51 个 `moxi_*` 工具。
QQ 网关、抖音、联网都是**可选接线**——没接的时候动作会明确报 `not-connected`，不会静默失败。

## 装

```bash
# 本地目录安装（DSH「插件」页面 → 添加插件 → 选这个目录）
# 或
dsh plugin add <path-to-this-package>
```

安装后在 profile 的 `cordis.patch.yml` 里能看到 `moxi` 这一行；配置改这一行的 `config`。

## 配置

```yaml
- insert:
    - id: moxi
      name: 'dsh-moxi'
      config:
        home: ''                     # 留空：DSH profile 目录/moxi，再退到 ~/.dsh-moxi
        gateway:
          enabled: false             # 接了 OneBot 才开
          baseUrl: 'http://127.0.0.1:3004'
          wsUrl: 'ws://127.0.0.1:3005'
        tools:
          prefix: moxi
```

数据落在 `home` 下：`data/memory.sqlite`（记忆/流水/约定/黑话）、`data/persona/role-card.md`（人格卡，只读）、
`state/*.json`（暂停/模式/护栏）、`data/logs/`。

## 能力现状

| 类别 | 动作数 | 状态 |
|---|---|---|
| 本地（记忆/状态/护栏/表情/日志/额度） | 24 | ✅ 已实现并有测试 |
| QQ 网关（收发/未读/引用/拍一拍…） | 18 | ⏳ 适配器中（未接时返回 `not-connected`） |
| 大脑回合（演练/日报/目的素材/唤醒/收尾） | 5 | ✅ 已实现（演练走 ctx.llm.stream） |
| 抖音（入口转发） | 2 | ⏳ 需要配套抖音 bundle |
| 联网（搜索/抓取） | 2 | ✅ 走 DSH `ctx.web` |

## 主动开口

配置 purpose.enabled: true 且网关 + llm 都在时，插件按 purpose.tickMs（默认 5 分钟）检查一次：
暂停中、静默时段、当日上限、间隔不足、唤醒额度用完 —— 任一命中就不开口。开口前过一次出站安检，
说完记流水与记忆。moxi_status 里能看到 purpose.verdict（当前为什么不说话）。

## 从旧运行时迁移

旧运行时（独立守护进程那套）的库表结构与本插件一致，可以直接搬：

```bash
node scripts/import-from-runtime.mjs --from <旧运行时根目录> --to <本插件 home> [--dry]
```

搬 `memory.sqlite` 的六张表（列名取交集，重复行跳过）、`persona/*.md`、`mode/send-guard/wake-budget/stickers/access.json`；
日志、会话归档、图片、抖音状态不搬。`--dry` 只打印计划。

## 配置参考

完整字段见 `moxi.config.example.json`。常用的几项：

| 字段 | 作用 |
|---|---|
| `home` | 数据目录；留空按 DSH profile → `~/.dsh-moxi` 兜底 |
| `gateway.enabled / baseUrl / wsUrl / token` | OneBot 11 网关；不开就全部网关动作返回 `not-connected` |
| `access.allow.private / groups` | 许可名单，名单外一律拒发 |
| `send.maxSendPerMinute / maxSendPerHour` | 发送限速 |
| `history.enabled` | 是否允许 `moxi_catchup` 拉历史（默认 false，避免清库后又把历史灌回来） |
| `mood.rates / thresholds` | 心情漂移速度与描述阈值 |
| `purpose.*` | 主动开口：总开关、目标会话、每日上限、间隔、静默时段、检查频率 |
| `agent.provider / model` | 演练用的模型；留空跟随 DSH 默认模型 |

## 开发

```bash
node --test "test/*.test.mjs"        # 5 个用例：注册契约、工具 schema、本地动作、未接线行为、卸载
node --check index.mjs
```

`test/smoke.test.mjs` 用一个假 `ctx` 跑，不需要装进 DSH。

## 设计约束

- **人格只读**：卡是用户资产，插件只读不写。
- **记忆是派生缓存**：会话日志才是真相；记忆坏了可以从日志重建。
- **不外发**：除 `outbound` 标记的动作外，插件不主动发消息。
- **路径可移植**：没有写死盘符；`home` 决定一切数据位置。
