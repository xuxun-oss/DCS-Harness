// dsh-dcs-cloud — DCS 云平台客户端（Host 侧，纯 Node）。
// 封装 BGI Research 发布的 `dcs` CLI（Go 二进制，https://github.com/BGIResearch/dcs_cli）：
//   - 二进制管理：检测/下载（含 SHA256 校验）到 ~/.dsh/dcs-bin/dcs
//   - PAT 登录：dcs auth login --token <PAT>
//   - 命令执行：execFile 运行 dcs 命令，统一 --output json，解析 {data,error,exit_code,...}
//
// 配置持久化于 ~/.dsh/dcs-cloud.json；PAT 交给 dcs 自身加密存储（~/.dcs/config.yaml），
// 本插件不落盘明文 PAT（仅运行时使用）。

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

// ---- dcs CLI 发行版（v1.1.0）----
export const DCS_VERSION = 'v1.1.0';
export const DCS_RELEASE_BASE = 'https://github.com/BGIResearch/dcs_cli/releases/download/' + DCS_VERSION;
const RELEASE_SHA = {
  'dcs-linux-amd64': '6b8f6a62caae15fb5bdab0d26740d680721d8a150d20a0d52878483fdcbd1105',
  'dcs-darwin-amd64': '9043eab87228d4cf2995c9f9904122ab48521c549a453b8c45a7f1de6223be6a',
  'dcs-darwin-arm64': '2576f3d5c2102015df8e6c5530aaceb5fbb6443ec10d1502f7690d6a04f5b1ec',
  'dcs-darwin-universal': '842c8ef0f533d8c3184fd36bdd59900739899324fb92ff2f3aad4d63a1d66dff',
  'dcs.exe': '83dba6bd8d1defc00d4db3b6ada8f72a4d91aa453f6911f36c5ed38e8f35b49e',
};

export const DEFAULT_CFG = {
  // dcs CLI 二进制路径或名称；默认 'dcs'（在 PATH 中查找，找不到则自动下载）。
  cliPath: 'dcs',
  // 自动下载开关：auto（找不到就下载）| never（只用已有二进制）
  autoInstall: 'auto',
};

// ---- 配置 ----
export function cfgPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dcs-cloud.json');
}

export function loadCfg() {
  let file = {};
  try { file = JSON.parse(readFileSync(cfgPath(), 'utf8')); } catch { /* 无文件 */ }
  return {
    ...DEFAULT_CFG,
    ...file,
    cliPath: process.env.DCS_CLI_PATH || file.cliPath || DEFAULT_CFG.cliPath,
  };
}

export function saveCfg(next) {
  mkdirSync(dirname(cfgPath()), { recursive: true });
  writeFileSync(cfgPath(), JSON.stringify(next, null, 2));
}

// ---- 平台 / 二进制 ----
export function platformBinary() {
  const p = process.platform; // darwin | linux | win32
  const a = process.arch; // arm64 | x64 | ...
  if (p === 'darwin' && a === 'arm64') return 'dcs-darwin-arm64';
  if (p === 'darwin' && a === 'x64') return 'dcs-darwin-amd64';
  if (p === 'darwin') return 'dcs-darwin-universal';
  if (p === 'linux' && a === 'x64') return 'dcs-linux-amd64';
  if (p === 'win32') return 'dcs.exe';
  return null;
}

export function managedBinDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dcs-bin');
}
export function managedBinPath() {
  const name = platformBinary();
  return name ? join(managedBinDir(), name) : null;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** 下载 dcs 二进制并校验 SHA256，返回落盘路径；失败抛错。 */
export async function downloadDcsBinary(signal) {
  const name = platformBinary();
  if (!name) throw new Error('当前平台无可用 dcs 二进制（' + process.platform + '/' + process.arch + '）');
  const url = DCS_RELEASE_BASE + '/' + name;
  const out = managedBinPath();
  mkdirSync(managedBinDir(), { recursive: true });
  const t = AbortSignal.timeout(300000);
  const sig = signal ? AbortSignal.any([signal, t]) : t;
  const res = await fetch(url, { signal: sig });
  if (!res.ok) throw new Error('下载失败: HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const expect = RELEASE_SHA[name];
  const got = sha256(buf);
  if (expect && got !== expect) throw new Error('SHA256 校验失败：期望 ' + expect + '，实际 ' + got);
  writeFileSync(out, buf);
  chmodSync(out, 0o755);
  return out;
}

function isExecutable(p) {
  return new Promise((resolve) => {
    try {
      execFile(p, ['--version'], { timeout: 20000 }, (err) => resolve(!err));
    } catch { resolve(false); }
  });
}

/** 解析可用二进制路径：cliPath → PATH → 已下载 → 自动下载。 */
export async function resolveDcsBinary(cfg, signal) {
  const candidates = [];
  if (cfg.cliPath && cfg.cliPath !== 'dcs') candidates.push(cfg.cliPath);
  candidates.push('dcs'); // PATH 查找
  const managed = managedBinPath();
  if (managed) candidates.push(managed);

  for (const c of candidates) {
    if (await isExecutable(c)) return { path: c, source: c === managed ? 'managed' : 'configured' };
  }
  if (cfg.autoInstall !== 'never') {
    const p = await downloadDcsBinary(signal);
    return { path: p, source: 'downloaded' };
  }
  throw new Error('未找到 dcs CLI，且 autoInstall=never。请用 dcs_configure 指定 cliPath 或安装 dcs。');
}

// ---- 命令执行 ----

/**
 * 运行 dcs 命令（统一追加 --output json）。
 * @param {string[]} args 不含二进制名的参数（如 ['data','ls','/Files']）
 * @param {object} opts { signal, timeoutMs, output: 'json'|'table'|'ndjson', cwd, env }
 */
export async function runDcs(cfg, args, opts) {
  const o = opts || {};
  const bin = await resolveDcsBinary(cfg, o.signal);
  const out = o.output || 'json';
  const fullArgs = [...args, '--output', out];
  if (o.noHistory !== false) fullArgs.push('--no-history');
  const result = await new Promise((resolve) => {
    let child;
    try {
      child = execFile(bin.path, fullArgs, {
        timeout: o.timeoutMs || 180000,
        maxBuffer: 40 * 1024 * 1024,
        cwd: o.cwd,
        env: { ...process.env, ...(o.env || {}) },
      }, (err, stdout, stderr) => {
        resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
      if (o.signal) {
        o.signal.addEventListener('abort', () => { try { child.kill('SIGKILL'); } catch {} }, { once: true });
      }
    } catch (e) {
      resolve({ err: e, stdout: '', stderr: String(e.message || e) });
    }
  });

  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch { /* 非 JSON（table 等） */ }
  return {
    ok: !result.err && parsed !== null && (parsed.exit_code === 0 || parsed.exit_code === undefined),
    exit_code: parsed ? parsed.exit_code : (result.err ? (result.err.code || 1) : 0),
    data: parsed ? parsed.data : null,
    error: parsed ? parsed.error : (result.err ? String(result.err.message || result.err) : ''),
    message: parsed ? parsed.message : '',
    raw: result.stdout,
    stderr: result.stderr,
    binary: bin.path,
    source: bin.source,
  };
}

/** 登录（dcs auth login --token <PAT>）。 */
export async function dcsLogin(cfg, token, opts) {
  return runDcs(cfg, ['auth', 'login', '--token', String(token || '')], { ...(opts || {}), timeoutMs: 60000 });
}

/** 通用状态快照（当前用户/区域/项目）。 */
export async function dcsStatus(cfg, opts) {
  const [project, region] = await Promise.all([
    runDcs(cfg, ['project', 'current'], { ...(opts || {}), timeoutMs: 60000 }).catch(() => null),
    runDcs(cfg, ['region', 'current'], { ...(opts || {}), timeoutMs: 60000 }).catch(() => null),
  ]);
  return { project, region };
}
