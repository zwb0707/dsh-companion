# Changelog

## 0.1.0

首个可运行版本：把原独立运行时的能力搬进 DSH Cordis 插件。

- 51 个 `moxi_*` 工具：24 个纯本地动作 + 18 个 QQ 网关动作 + 5 个大脑动作 + 2 个抖音入口 + 2 个联网动作
- 记忆库（SQLite，表结构兼容旧运行时）、人格卡只读、四维心情、四个护栏（出站/回合/唤醒/群冷却）
- 主动开口循环：暂停、静默时段、每日上限、间隔抖动、唤醒额度依次把关
- QQ 网关：OneBot 11 HTTP + WebSocket，含限速、失败熔断、许可名单、审计
- 大脑：`ctx.llm.stream` 进程内调用，演练不发送；日报/目的素材/唤醒/收尾纯本地
- 抖音入口：懒查找 `moxiDouyin` 服务，未注入时返回 `not-connected`
- 未接线的动作返回 `not-connected` 并说明缺什么，不静默失败
- 迁移脚本 `scripts/import-from-runtime.mjs`：按列名交集搬旧库与人格卡，`--dry` 可预览
- 零第三方依赖；数据目录由 `home` 决定，代码里没有写死盘符
- 已在真实 DSH 0.2.2-rc.3 里装成 bundle 跑通：51 个工具在线、SQLite 读写正常、`moxi_simulate` 走宿主 `ctx.llm` 真实生成（不计入发送）
- 两处宿主约定已按实测修正：插件 `apply` 不能返回值（会被当 disposer）；`render` 需兼容 `(args, value)` 调用顺序
