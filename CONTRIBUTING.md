# 参与

## 开发

```bash
node --test test/     # 43 个用例，全部本地跑，不需要装进 DSH
node --check index.mjs
```

## 约定

- 只加能力，不改工具语义：工具名一旦发布就不要再改（`moxi_*` 小写蛇形）。
- 每个新动作都要先在 `src/catalog.mjs` 登记（名字/说明/需要什么/是否外发），再在 `src/dispatch.mjs` 或对应服务里实现。
- 新增文件记得加进 `package.json` 的 `files`；`test/packaging.test.mjs` 会检查覆盖。
- 不提交任何运行数据（`data/`、`state/`、`*.sqlite`、日志）。
- 提交信息用一句话说清"改了什么、为什么"。
