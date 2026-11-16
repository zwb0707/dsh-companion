# 发布手册（一次性上传）

仓库就是 `D:\her\packages\dsh-moxi` 这个目录本身（插件包 = 仓库根）。

## 0. 上传前已经就绪的东西

- `git init -b main` 已执行，38 个文件已 `git add`（**尚未 commit**）
- `.gitignore` 生效：`data/`、`state/`、`*.sqlite*`、`*.log`、`*.jsonl`、`node_modules/`、`*.tgz` 都不会进仓库
- `LICENSE`（MIT）、`README.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`.github/workflows/ci.yml`
- 发布元数据：`name=dsh-moxi`、`version=0.1.0`、`private=false`、`repository/homepage/bugs`（`zwb0707` 待替换）
- 自检：`node --test test/` → 45/45；`npm pack --dry-run` → 27 文件 / 102.3KB

## 1. 替换仓库地址里的 zwb0707

```powershell
cd D:\her\packages\dsh-moxi
$owner = '你的GitHub账号'
(Get-Content package.json -Raw).Replace('zwb0707', $owner) | Set-Content package.json -NoNewline
```

## 2. 首次提交

```powershell
cd D:\her\packages\dsh-moxi
git add -A
git -c user.name="Moxi contributors" -c user.email="noreply@example.com" commit -m "feat: initial dsh-moxi plugin (51 tools, gateway, agent turn, purpose loop)"
```

## 3. 建远端并推送

```powershell
# 先在 GitHub 上建空仓库 dsh-moxi（不要带 README/License，避免冲突）
git remote add origin https://github.com/<owner>/dsh-moxi.git
git push -u origin main
```

用 SSH 的话把 `origin` 换成 `git@github.com:<owner>/dsh-moxi.git`。

## 4. 上传后核对

1. GitHub 上 `Actions → ci` 跑绿（ubuntu + windows × node 22：`node --check` → `node --test` → `npm pack --dry-run`）。
2. 仓库里搜 `D:\her`、`3030887571`、`箫渡月`：应为 0 命中（`test/packaging.test.mjs` 已本地断言）。
3. 页面上「About」填描述 + 勾选 MIT license（元数据已带）。

## 5. 装到 DSH 验收（发布后）

```powershell
# 本地目录安装：DSH → 插件 → 添加插件 → 选 D:\her\packages\dsh-moxi
# 或从 npm：dsh plugin add dsh-moxi
```

装完后确认：

- 工具列表里出现 51 个 `moxi_*`
- `moxi_health` 能报出各项接线状态（QQ 网关/大脑/抖音/联网）
- **切换时先停用旧 `@local/her-douyin`**，否则它的 50 个同名 `moxi_*` 会跟新插件打架

## 6. 之后发版

```powershell
# 改 version（语义化），写 CHANGELOG，然后
npm publish --access public
git tag v0.1.0 && git push --tags
```
