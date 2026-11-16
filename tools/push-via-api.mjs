// 通过 GitHub Git Data API 推送（git 端点被网络重置时的备用通道）
// 用法：set GH_TOKEN_TMP=... 然后 node tools/push-via-api.mjs
import { execFileSync } from 'node:child_process';

const REPO = 'zwb0707/dsh-companion';
const CWD = 'D:/her/packages/dsh-moxi';
const TOKEN = process.env.GH_TOKEN_TMP;
if (!TOKEN) { console.error('缺 GH_TOKEN_TMP'); process.exit(2); }

const api = async (path, init = {}) => {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      authorization: 'Bearer ' + TOKEN,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

// 1) 远端当前 head
const ref = await api(`/repos/${REPO}/git/ref/heads/main`);
const baseSha = ref.object.sha;
const baseCommit = await api(`/repos/${REPO}/git/commits/${baseSha}`);
console.log('remote head =', baseSha.slice(0, 7), '| tree =', baseCommit.tree.sha.slice(0, 7));

// 2) 本地 HEAD 的文件列表（mode / blob sha / path）
const raw = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD'], { cwd: CWD, encoding: 'utf8' });
const localFiles = raw.split('\0').filter(Boolean).map((line) => {
  const [meta, path] = line.split('\t');
  const [mode, type, sha] = meta.split(' ');
  return { mode, type, sha, path };
});
console.log('本地 HEAD 文件数 =', localFiles.length);

// 3) 远端树（递归）用于跳过未改动文件
const remoteTree = await api(`/repos/${REPO}/git/trees/${baseCommit.tree.sha}?recursive=1`);
const remote = new Map(remoteTree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
const changed = localFiles.filter((f) => remote.get(f.path) !== f.sha);
const deleted = [...remote.keys()].filter((p) => !localFiles.some((f) => f.path === p));
console.log('需要更新 =', changed.length, '| 需要删除 =', deleted.length);
for (const f of changed) console.log('  ~', f.path);
for (const p of deleted) console.log('  -', p);

// 4) 上传 blob（只传改动的）
const entries = [];
for (const f of changed) {
  const content = execFileSync('git', ['cat-file', 'blob', f.sha], { cwd: CWD, encoding: 'buffer' });
  const blob = await api(`/repos/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }) });
  entries.push({ path: f.path, mode: f.mode, type: 'blob', sha: blob.sha });
}
for (const p of deleted) entries.push({ path: p, mode: '100644', type: 'blob', sha: null });

// 5) 新树 + 提交 + 更新 ref
const tree = await api(`/repos/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: entries }) });
const message = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: CWD, encoding: 'utf8' }).trim();
const commit = await api(`/repos/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] }) });
await api(`/repos/${REPO}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
console.log('新远端 head =', commit.sha);
console.log('提交信息 =', message.split('\n')[0]);
