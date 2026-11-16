// packaging.test.mjs —— 发布前自检：npm pack 里必须带上全部运行文件，且不带测试与个人数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PKG = path.resolve(import.meta.dirname, '..');
// npm 的 cli 位置随安装方式不同：官方安装器在 <node>/node_modules，CI 的 setup-node 在 <node>/lib/node_modules
const NPM_CANDIDATES = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  path.join(path.dirname(process.execPath), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js',
].filter(Boolean);
const NPM_CLI = NPM_CANDIDATES.find((p) => fs.existsSync(p));
const hasNpm = Boolean(NPM_CLI);

function packList() {
  if (!hasNpm) return { info: { unpackedSize: 0, files: [] }, paths: [], skipped: true };
  const raw = execFileSync(process.execPath, [NPM_CLI, 'pack', '--dry-run', '--json'], { cwd: PKG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const info = JSON.parse(raw)[0];
  return { info, paths: info.files.map((f) => f.path), skipped: false };
}

const { info, paths, skipped } = packList();
const SKIP = skipped ? '本机没有 npm cli，跳过打包断言' : false;

test('打包自检可用（npm 存在）', { skip: SKIP }, () => {
  assert.ok(paths.length > 10, '打包文件数异常：' + paths.length);
});

test('pack 体积合理', { skip: SKIP }, () => {
  assert.ok(info.unpackedSize < 400 * 1024, '解包体积应小于 400KB，实际 ' + info.unpackedSize);
});

test('src 下每个 .mjs 都进包', { skip: SKIP }, () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else out.push(path.relative(PKG, p).replace(/\\/g, '/'));
    }
    return out;
  };
  const runtime = walk(path.join(PKG, 'src')).filter((p) => p.endsWith('.mjs'));
  assert.ok(runtime.length >= 15, '运行时模块数不对：' + runtime.length);
  for (const file of runtime) assert.ok(paths.includes(file), '缺运行文件：' + file);
});

test('入口、清单、资源、文档都在包里', { skip: SKIP }, () => {
  for (const need of ['index.mjs', 'package.json', 'cordis.bundle.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json', 'docs/DETAIL.md', 'docs/RULES.md', 'README.md']) {
    assert.ok(paths.includes(need), '缺文件：' + need);
  }
});

test('不打包测试与本地数据', { skip: SKIP }, () => {
  for (const p of paths) {
    assert.ok(!p.startsWith('test/'), '不该打包测试：' + p);
    assert.ok(!/\.(sqlite|log|jsonl)$/.test(p), '不该打包数据文件：' + p);
    assert.ok(!p.startsWith('data/') && !p.startsWith('state/'), '不该打包运行数据：' + p);
  }
});

test('发布元数据正确', { skip: SKIP }, () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  assert.equal(pkg.private, false, '要能发布，private 必须 false');
  assert.ok(!String(pkg.name).startsWith('@local'), '包名不能是 @local/...');
  assert.match(String(pkg.name), /^[a-z0-9][a-z0-9._-]*$/, '包名不符合 npm 规则');
  assert.equal(pkg.license, 'MIT');
  assert.ok(fs.existsSync(path.join(PKG, 'LICENSE')), '缺 LICENSE');
  assert.ok(String(pkg.repository?.url ?? '').includes('github.com'), '缺 repository');
  const patch = fs.readFileSync(path.join(PKG, 'cordis.bundle.yml'), 'utf8');
  assert.ok(patch.includes(`'${pkg.name}'`), 'cordis.bundle.yml 里的包名要和 package.json 一致');
  const engines = pkg.engines ?? {};
  assert.ok(String(engines.node ?? '').length > 0, '缺 engines.node');
});

test('包内不出现本机绝对路径与个人标识', { skip: SKIP }, () => {
  const banned = [/D:\\her/i, /D:\/her/i, /C:\\Users/i, /127\.0\.0\.1:3155/, /3030887571/, /1919966954/, /箫渡月/, /文墨识博/];
  for (const p of paths) {
    if (!/\.(mjs|json|yml|md|svg)$/.test(p)) continue;
    const text = fs.readFileSync(path.join(PKG, p), 'utf8');
    for (const re of banned) assert.ok(!re.test(text), `${p} 里还有 ${re}`);
  }
});
