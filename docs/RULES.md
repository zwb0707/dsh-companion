// RULES.md —— 给模型看的工具使用规约（moxi_docs 会返回它）

# 工具使用规约（moxi）

## 三条铁律

1. **先查再动**：不确定该用哪个 → `moxi_capabilities`；不确定状态 → `moxi_status`；怀疑接线问题 → `moxi_health`。
2. **会外发的动作先确认**：`moxi_send` / `moxi_burst` / `moxi_send_image` / `moxi_forward` / `moxi_poke` / `moxi_react` / `moxi_media_share`
   会真的出现在 QQ / 抖音里。不要拿别人的号做试验；只想看效果用 `moxi_simulate`。
3. **人格只读**：人格卡只由用户维护；工具里没有、也不该有人格写入动作。

## 记忆

- `moxi_memory`：`query`/`list` 只读；`update`/`delete`/`add` 会改库，删除是硬删除。
- 改一条之前先 `query` 核对 id；不要批量改写历史；不要写凭据。

## 节奏

- `moxi_pause` 暂停主动消息（`hours=0` 恢复）；`moxi_pause_status` 只读。
- `moxi_clear_outbox` 会丢掉还没发出的消息。

## 未接线的动作

返回值里 `code: "not-connected"` 表示这条动作需要的外部服务没接上，`need` 会写明缺哪一类
（`gateway` / `agent` / `douyin` / `web`），`error` 里有怎么接。不要重试同一个动作。
