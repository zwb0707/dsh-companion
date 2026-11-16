# 插件说明（dsh-moxi）

## 它做什么

给 DSH 加一个**本地人格运行时**：一张只读人格卡、一个记忆库（SQLite）、一套护栏（发送冷却 / 唤醒额度 / 回合上限）、
主动开口的开关与额度，以及 51 个 `moxi_*` 工具。工具在进程内直接调本地实现，不经 HTTP 控制面。

## 现在能做什么

- 记忆：查询 / 列举 / 写入 / 修改 / 置顶 / 删除
- 状态：总状态、自检、护栏、暂停、模式、额度与花费、作息、社交名单
- 表情：列表、收藏、取图
- 审计与日志：读最近动作、按关键词查日志
- 联网：`webSearch` / `webFetch`（走 DSH 的 web 服务）

## 还需要接线才有用

| 依赖 | 影响的动作 | 怎么接 |
|---|---|---|
| QQ 网关（OneBot 11） | 收发消息、未读、上下文、拍一拍、表情回应、转发、补历史 | 配置 `gateway.baseUrl/wsUrl` 并 `enabled: true` |
| 大脑回合（DSH agent） | 演练、日报、主动素材、唤醒、收尾 | 由插件内适配器接 `ctx.agentLoop` / 子代理 |
| 抖音 bundle | `moxi_douyin` / `moxi_douyin_account` | 安装配套抖音插件 |

未接线时这些动作返回 `{ ok:false, code:'not-connected', need, error }`，`error` 写明怎么接；不会假装成功。

## 边界

- 人格卡**只读**：插件没有写入人格的动作。
- `outbound` 动作（send / burst / send_image / forward / poke / react / media_share）会真的发出去。
- 记忆删除是硬删除，没有回收站。
- 数据只在 `home` 目录里，不写系统其它位置。
