// home.mjs —— 数据目录解析（不含任何绝对路径）
//
// 优先级：config.home > env DSH_MOXI_HOME > <DSH profile 目录>/moxi > <os.homedir()>/.dsh-moxi
// 目标：装到任何机器上都能跑，数据落在用户自己的目录里。

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function resolveHome(config = {}, env = process.env) {
  const candidates = [
    config?.home,
    env.DSH_MOXI_HOME,
    env.DSH_PROFILE_DIR ? path.join(env.DSH_PROFILE_DIR, 'moxi') : '',
    path.join(os.homedir(), '.dsh-moxi'),
  ].filter((x) => typeof x === 'string' && x.trim().length);

  const home = path.resolve(candidates[0]);
  const dirs = {
    home,
    data: path.join(home, 'data'),
    persona: path.join(home, 'data', 'persona'),
    logs: path.join(home, 'data', 'logs'),
    media: path.join(home, 'data', 'media'),
    state: path.join(home, 'state'),
    db: path.join(home, 'data', 'memory.sqlite'),
    config: path.join(home, 'moxi.config.json'),
  };
  return dirs;
}

/** 建目录 + 落一份默认配置（只在缺失时写，不覆盖用户配置） */
export function ensureHome(dirs, defaults = {}) {
  for (const key of ['home', 'data', 'persona', 'logs', 'media', 'state']) fs.mkdirSync(dirs[key], { recursive: true });
  if (!fs.existsSync(dirs.config)) {
    fs.writeFileSync(dirs.config, JSON.stringify(defaults, null, 2) + '\n', 'utf8');
  }
  return dirs;
}

export function readConfig(dirs, fallback = {}) {
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(dirs.config, 'utf8')) }; }
  catch { return { ...fallback }; }
}
