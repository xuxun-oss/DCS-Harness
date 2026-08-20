// dsh-dcs-cloud — 宿主半（Host）。
// 面向 DCS Cloud 基因组/时空组学研究的编排插件：封装 BGI Research 的 `dcs` CLI，
// 提供数据检索、Genpilot 流程复用、在线容器、离线任务投递、脚本审计与学术报告生成，
// 并通过 systemPrompt 引导 agent 走「分解 → 研究 → 方案 → 数据 → 脚本 → 审计 → 执行 → 报告」流程。
//
// 依赖 dcs CLI（本机二进制）：PATH 里有则用，没有则按平台自动下载（含 SHA256 校验）。

import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  loadCfg, saveCfg, runDcs, dcsLogin, dcsStatus, publicSearch,
  resolveDcsBinary, platformBinary, DCS_VERSION,
} from './dcs-client.js';
import { auditScript } from './audit.js';
import { generateReport } from './report.js';
import { generatePlan } from './plan.js';
import { loadTasks, upsertTask, updateStepStatus, getTask } from './tasks.js';
import {
  REGIONS, OMICS_TOOLS, KEYWORD_TO_CATEGORY, searchHints, genpilotHints,
  GENPILOT_PATTERN, CONTAINER_PUBLIC, PUBLIC_DATASETS, containerHints,
} from './atlas.js';

/** Cordis 插件名 —— 必须与 cordis.patch.yml 里的行 id 一致。 */
export const name = 'dsh-dcs-cloud';

/** 硬依赖的宿主服务。 */
export const inject = ['tools', 'systemPrompt', 'webServer'];

const OUTPUT_CAP = 40000; // 单工具结果文本上限（字符）

function workspaceOf(exec) {
  return (exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd) || process.cwd();
}

/** 把 dcs 命令结果裁剪成稳定的文本视图。 */
function cliView(r) {
  let text;
  if (r.ok) {
    try { text = JSON.stringify(r.data, null, 2); } catch { text = r.raw; }
  } else {
    text = r.error || r.stderr || r.raw || '(无输出)';
  }
  let truncated = false;
  if (text.length > OUTPUT_CAP) { text = text.slice(0, OUTPUT_CAP) + '\n…（已截断）'; truncated = true; }
  return {
    ok: r.ok,
    exit_code: r.exit_code,
    message: r.message || '',
    error: r.error || '',
    output: text,
    truncated,
    binary: r.binary || '',
  };
}

/** 通用 CLI 工具执行包装：build(args) → runDcs → cliView。 */
async function execCli(exec, build, timeoutMs) {
  const cfg = loadCfg();
  try {
    const r = await runDcs(cfg, build(), { signal: exec && exec.signal, timeoutMs: timeoutMs || 180000 });
    return cliView(r);
  } catch (e) {
    return { ok: false, exit_code: 1, message: '', error: String(e && e.message || e), output: String(e && e.message || e), truncated: false, binary: '' };
  }
}

function str(v) { return v === undefined || v === null ? '' : String(v); }

// ---- 工具定义 ----

export function apply(ctx) {
  // ---------- 配置 / 登录 / 状态 ----------

  ctx.tools.register(defineTool({
    name: 'dcs_configure',
    description: '配置 dcs CLI 的本地参数（cliPath、autoInstall）。Genpilot LLM 与 Genos 为 DCS 系统自带、模型自动选择、无需额外 API key。PAT 登录请用 dcs_login。',
    parameters: {
      cliPath: { type: 'string', description: 'dcs 二进制路径或名称，默认 "dcs"（在 PATH 中查找）' },
      autoInstall: { type: 'string', enum: ['auto', 'never'], description: '找不到二进制时是否自动从 GitHub 下载：auto=自动下载（默认），never=不下载' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          cliPath: { type: 'string', required: true },
          autoInstall: { type: 'string', required: true },
          platform: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render(args, v) { return [{ type: 'text', text: v.ok ? ('✅ dcs 配置已保存：cliPath=' + v.cliPath + '，autoInstall=' + v.autoInstall + '（平台 ' + v.platform + '）。Genpilot LLM / Genos 为系统自带，无需配置 key。') : ('❌ 配置失败: ' + (v.error || '')) }]; },
    },
    async execute(args) {
      const cfg = loadCfg();
      const next = { ...cfg };
      if (str(args.cliPath)) next.cliPath = str(args.cliPath);
      if (args.autoInstall) next.autoInstall = args.autoInstall;
      saveCfg(next);
      return { ok: true, cliPath: next.cliPath, autoInstall: next.autoInstall, platform: platformBinary() || (process.platform + '/' + process.arch), error: '' };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_login',
    description: '登录 DCS Cloud：自动确保 dcs 二进制可用（缺失则下载校验），用个人访问令牌(PAT, 形如 dcs_pat_...)登录，可同时切换项目/片区。',
    parameters: {
      token: { type: 'string', required: true, description: 'DCS Cloud 个人访问令牌（dcs_pat_...），仅运行时使用，不落盘明文' },
      project_id: { type: 'string', description: '可选：切换到的项目 ID（如 P1871461072416366593）' },
      region: { type: 'string', description: '可选：切换到的片区（如 DCS-华南1）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          username: { type: 'string', required: true },
          user_id: { type: 'string', required: true },
          region: { type: 'string', required: true },
          project: { type: 'string', required: true },
          binary: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render(args, v) { return [{ type: 'text', text: v.ok ? ('✅ 已登录 DCS Cloud：' + v.username + '（' + v.region + '，项目 ' + v.project + '）') : ('❌ 登录失败: ' + (v.error || '')) }]; },
    },
    timeoutMs: 180000,
    async execute(args, exec) {
      const cfg = loadCfg();
      try {
        const bin = await resolveDcsBinary(cfg, exec && exec.signal);
        const r = await dcsLogin(cfg, args.token, { signal: exec && exec.signal });
        if (!r.ok) {
          return { ok: false, username: '', user_id: '', region: '', project: '', binary: bin.path, error: (r.error || r.message || '登录失败，PAT 可能无效或已过期') };
        }
        // 保存 PAT 供公共库直连检索（dcs_public_search）使用
        if (str(args.token)) { saveCfg({ ...cfg, pat: str(args.token) }); }
        if (str(args.region)) { await runDcs(cfg, ['region', 'switch', str(args.region)], { signal: exec && exec.signal, timeoutMs: 60000 }); }
        if (str(args.project_id)) { await runDcs(cfg, ['project', 'switch', '--id', str(args.project_id)], { signal: exec && exec.signal, timeoutMs: 60000 }); }
        const st = await dcsStatus(cfg, { signal: exec && exec.signal });
        const pdata = (st.project && st.project.data) || {};
        const rdata = (st.region && st.region.data) || {};
        const loginData = r.data || {};
        return {
          ok: true,
          username: loginData.username || pdata.username || '',
          user_id: String(loginData.user_id || pdata.user_id || ''),
          region: rdata.current_region || loginData.current_region || str(args.region),
          project: (pdata.current_project || loginData.current_project || str(args.project_id) || ''),
          binary: bin.path,
          error: '',
        };
      } catch (e) {
        return { ok: false, username: '', user_id: '', region: '', project: '', binary: '', error: String(e && e.message || e) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_status',
    description: '查看 DCS Cloud 当前状态：登录用户、当前片区、当前项目、dcs 二进制来源与版本。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          username: { type: 'string', required: true },
          region: { type: 'string', required: true },
          project: { type: 'string', required: true },
          project_name: { type: 'string', required: true },
          binary: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render(args, v) { return [{ type: 'text', text: v.ok ? ('DCS 状态：' + v.username + '｜片区 ' + v.region + '｜项目 ' + v.project + '（' + v.project_name + '）｜二进制 ' + v.binary) : ('⚠️ ' + (v.error || '未登录')) }]; },
    },
    timeoutMs: 90000,
    async execute(args, exec) {
      const cfg = loadCfg();
      try {
        const bin = await resolveDcsBinary(cfg, exec && exec.signal);
        const st = await dcsStatus(cfg, { signal: exec && exec.signal });
        const pdata = (st.project && st.project.data) || {};
        const rdata = (st.region && st.region.data) || {};
        return {
          ok: !!(pdata.current_project || rdata.current_region),
          username: pdata.username || rdata.username || '',
          region: rdata.current_region || '',
          project: pdata.current_project || '',
          project_name: pdata.current_project_name || '',
          binary: bin.path + '（' + bin.source + '，' + DCS_VERSION + '）',
          error: '',
        };
      } catch (e) {
        return { ok: false, username: '', region: '', project: '', project_name: '', binary: '', error: String(e && e.message || e) };
      }
    },
  }));

  // ---------- 数据（公共库优先） ----------

  ctx.tools.register(defineTool({
    name: 'dcs_data_ls',
    description: '列出 DCS Cloud 数据管理目录（/Files 文件结构）内容。文件系统根目录含 ReferenceData/RawData/ManualData/ResultData 等。',
    parameters: {
      path: { type: 'string', description: '目录或文件路径，如 /Files、/Files/RawData；省略则列当前目录' },
      long: { type: 'boolean', description: '是否显示详细信息（大小/时间/创建者）' },
      time_sort: { type: 'boolean', description: '按时间倒序排序' },
      size_sort: { type: 'boolean', description: '按文件大小排序' },
      page: { type: 'integer', description: '页码，默认 1' },
      page_size: { type: 'integer', description: '每页条数，最大 200，默认 20' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '📁 数据目录：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    async execute(args, exec) {
      return execCli(exec, () => {
        const a = ['data', 'ls'];
        if (str(args.path)) a.push(str(args.path));
        if (args.long) a.push('-l');
        if (args.time_sort) a.push('-t');
        if (args.size_sort) a.push('-s');
        if (args.page) a.push('--page', String(args.page));
        if (args.page_size) a.push('--page-size', String(args.page_size));
        return a;
      }, 120000);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_data_find',
    description: '在 DCS Cloud 数据管理里按条件检索文件（第一优先级：平台公共数据库/项目数据）。支持名称通配、类型、大小、实体/样本/SN/任务/流程/创建者/时间过滤。',
    parameters: {
      path: { type: 'string', description: '搜索路径，默认当前目录（可指定 /Files 全库）' },
      name: { type: 'string', description: '名称过滤，支持通配符，如 *.fq.gz、*.csv' },
      type: { type: 'string', enum: ['f', 'd'], description: '按类型过滤：f=文件，d=目录' },
      size: { type: 'string', description: '按大小过滤，如 +100M、-1G' },
      entity: { type: 'string', description: '按实体 ID 过滤' },
      sample: { type: 'string', description: '按样本 ID 过滤' },
      sn: { type: 'string', description: '按 SN 编号过滤' },
      task: { type: 'string', description: '按任务 ID 过滤' },
      workflow: { type: 'string', description: '按流程名（可带版本）过滤' },
      user: { type: 'string', description: '按创建者过滤' },
      time: { type: 'string', description: '按时间过滤，如 2024-01-01~2024-12-31 或单日' },
      page: { type: 'integer', description: '页码，默认 1' },
      page_size: { type: 'integer', description: '每页条数，最大 200' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '🔍 检索结果：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    async execute(args, exec) {
      return execCli(exec, () => {
        const a = ['data', 'find'];
        if (str(args.path)) a.push('-p', str(args.path));
        if (str(args.name)) a.push('-n', str(args.name));
        if (args.type) a.push('-t', args.type);
        if (str(args.size)) a.push('-s', str(args.size));
        if (str(args.entity)) a.push('-e', str(args.entity));
        if (str(args.sample)) a.push('-a', str(args.sample));
        if (str(args.sn)) a.push('-N', str(args.sn));
        if (str(args.task)) a.push('-k', str(args.task));
        if (str(args.workflow)) a.push('-w', str(args.workflow));
        if (str(args.user)) a.push('-u', str(args.user));
        if (str(args.time)) a.push('-T', str(args.time));
        if (args.page) a.push('--page', String(args.page));
        if (args.page_size) a.push('--page-size', String(args.page_size));
        return a;
      }, 120000);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_data_info',
    description: '查看 DCS Cloud 文件/目录的详细元数据（大小、时间、样本、SN 等）。',
    parameters: { path: { type: 'string', required: true, description: '文件或目录路径，如 /Files/RawData/V350099495_L04_read_2.fq.gz' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '📄 元数据：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    async execute(args, exec) { return execCli(exec, () => ['data', 'info', '-p', str(args.path)], 60000); },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_data_download',
    description: '从 DCS Cloud 下载文件/目录到本机（第二优先级：外部/本地数据获取，或拉取结果）。web 模式仅支持 ≤200MB 文本类文件；大文件用 ossutil/raysync 等。',
    parameters: {
      path: { type: 'string', required: true, description: '云平台路径，多个用英文逗号分隔' },
      target: { type: 'string', description: '本机目标目录（可选，默认当前目录）' },
      type: { type: 'string', enum: ['web', 'raysync', 'ossutil', 'tosutil', 'obsutil', 'aws', 'mount'], description: '下载方式，默认 web' },
      mode: { type: 'string', enum: ['client', 'command'], description: 'raysync 模式：command（默认）/client' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '⬇️ 下载：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 600000,
    async execute(args, exec) {
      return execCli(exec, () => {
        const a = ['data', 'download', '-T', str(args.type) || 'web', '-p', str(args.path)];
        if (str(args.target)) a.push('-t', str(args.target));
        if (str(args.mode)) a.push('-m', str(args.mode));
        return a;
      }, 600000);
    },
  }));

  // ---------- Genpilot 流程 / 脚本复用 ----------

  ctx.tools.register(defineTool({
    name: 'dcs_workflow_search',
    description: '检索 DCS Cloud 工作流（WDL 流程，即 Genpilot 现有脚本/方案，第一优先级复用）。-p 查公共库（官方/共享流程），默认查项目内流程；支持按名称/标签/创建者过滤。',
    parameters: {
      name: { type: 'string', description: '流程名，模糊匹配' },
      public: { type: 'boolean', description: 'true=查公共库（官方 DCS 流程），false=查项目内' },
      tag: { type: 'string', description: '按标签过滤，多个用逗号分隔' },
      user: { type: 'string', description: '按创建者过滤' },
      all: { type: 'boolean', description: '查询全部（自动翻页）' },
      page: { type: 'integer', description: '页码，默认 1' },
      page_size: { type: 'integer', description: '每页条数，最大 200' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '🧬 工作流/脚本：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    async execute(args, exec) {
      return execCli(exec, () => {
        const a = ['workflow', 'ls'];
        if (str(args.name)) a.push('-n', str(args.name));
        if (args.public) a.push('-p');
        if (str(args.tag)) a.push('-t', str(args.tag));
        if (str(args.user)) a.push('-u', str(args.user));
        if (args.all) a.push('-a');
        if (args.page) a.push('--page', String(args.page));
        if (args.page_size) a.push('--page-size', String(args.page_size));
        return a;
      }, 120000);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_workflow_info',
    description: '查看指定工作流的完整信息：流程详情 + 参数规格(check_parameter) + 多步执行规划(plan)。这是复用 Genpilot 现有脚本方案的核心入口，参数规格可直接用于 dcs_workflow_run 投递。',
    parameters: {
      name: { type: 'string', required: true, description: '工作流名称，如 SAW-ST-lasso、Stereo_Miner_Clustering' },
      version: { type: 'string', description: '指定版本，默认最新' },
      public: { type: 'boolean', description: 'true=查公共库，false=查项目内' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '🧬 工作流详情：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 180000,
    async execute(args, exec) {
      const cfg = loadCfg();
      const sig = exec && exec.signal;
      const base = [];
      base.push('-n', str(args.name));
      if (str(args.version)) base.push('-v', str(args.version));
      if (args.public) base.push('-p');
      try {
        const [info, param, plan] = await Promise.all([
          runDcs(cfg, ['workflow', 'info', ...base], { signal: sig, timeoutMs: 90000 }),
          runDcs(cfg, ['workflow', 'check_parameter', ...base], { signal: sig, timeoutMs: 90000 }),
          runDcs(cfg, ['workflow', 'plan', ...base], { signal: sig, timeoutMs: 90000 }),
        ]);
        const merged = {
          info: info.ok ? info.data : null,
          parameters: (param.ok && param.data && param.data.wdl_parameter) ? param.data.wdl_parameter : null,
          plan: (plan.ok && plan.data && plan.data.wdl_plan) ? plan.data.wdl_plan : null,
        };
        const text = JSON.stringify(merged, null, 2);
        let truncated = false;
        let out = text;
        if (out.length > OUTPUT_CAP) { out = out.slice(0, OUTPUT_CAP) + '\n…（已截断）'; truncated = true; }
        return { ok: info.ok || param.ok || plan.ok, output: out, truncated, error: info.ok ? '' : (info.error || '') };
      } catch (e) {
        return { ok: false, output: String(e && e.message || e), truncated: false, error: String(e && e.message || e) };
      }
    },
  }));

  // ---------- 执行：在线 / 离线 ----------

  ctx.tools.register(defineTool({
    name: 'dcs_terminal_exec',
    description: '在 DCS Cloud 在线容器（Genpilot 智能分析环境）里执行 shell 命令 —— 用于简单/交互式任务在线运行。容器未开时自动打开后重试一次。',
    parameters: {
      command: { type: 'string', required: true, description: '要在容器内执行的 shell 命令，如 "ls /work"、"python3 analysis.py"' },
      cwd: { type: 'string', description: '容器内工作目录，默认 /work/{用户名}' },
      timeout: { type: 'integer', description: '命令超时（秒），默认 120' },
      auto_open: { type: 'boolean', description: '容器未开时是否自动打开（默认 true）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '🖥️ 在线执行：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 300000,
    async execute(args, exec) {
      const cfg = loadCfg();
      const sig = exec && exec.signal;
      const build = () => {
        const a = ['terminal', 'exec', '-c', str(args.command)];
        if (str(args.cwd)) a.push('--cwd', str(args.cwd));
        if (args.timeout) a.push('--timeout', String(args.timeout));
        return a;
      };
      try {
        let r = await runDcs(cfg, build(), { signal: sig, timeoutMs: (args.timeout || 120) * 1000 + 30000 });
        // 容器未开（83006/83007/未开等）时自动 open 后重试
        if (!r.ok && args.auto_open !== false && /83006|83007|容器|workspace|not open|open/i.test(r.error + ' ' + r.raw)) {
          await runDcs(cfg, ['terminal', 'open'], { signal: sig, timeoutMs: 180000 });
          await new Promise((res) => setTimeout(res, 4000));
          r = await runDcs(cfg, build(), { signal: sig, timeoutMs: (args.timeout || 120) * 1000 + 30000 });
        }
        return cliView(r);
      } catch (e) {
        return { ok: false, exit_code: 1, message: '', error: String(e && e.message || e), output: String(e && e.message || e), truncated: false, binary: '' };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_terminal_file',
    description: '在 DCS Cloud 在线容器里读写/编辑/上传下载文件 —— 用于在线环境里编写新脚本（第二优先级：重写脚本）或读写结果文件。',
    parameters: {
      op: { type: 'string', enum: ['read', 'create', 'edit', 'upload', 'download'], required: true, description: '操作：read 读文件 / create 创建写文件 / edit 精确替换编辑 / upload 本机上传 / download 下载到本机' },
      path: { type: 'string', required: true, description: '容器内绝对路径（read/create/edit 必填；download 为源路径）' },
      content: { type: 'string', description: 'create 时的文件内容' },
      old: { type: 'string', description: 'edit 时要替换的原文' },
      new: { type: 'string', description: 'edit 时的替换文本（可为空删除）' },
      replace_all: { type: 'boolean', description: 'edit 时是否替换全部匹配' },
      local: { type: 'string', description: 'upload 的本机源文件 / download 的本机目标文件' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '📝 容器文件：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 300000,
    async execute(args, exec) {
      return execCli(exec, () => {
        const op = args.op;
        const a = ['terminal', op];
        if (op === 'read' || op === 'create' || op === 'edit' || op === 'download') a.push('-p', str(args.path));
        if (op === 'create') a.push('-c', str(args.content));
        if (op === 'edit') { a.push('--old', str(args.old)); a.push('--new', str(args.new)); if (args.replace_all) a.push('--replace-all'); }
        if (op === 'upload') { a.push('-p', str(args.path)); a.push('-f', str(args.local)); }
        if (op === 'download') { a.push('-t', str(args.local)); }
        return a;
      }, 300000);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_offline_run',
    description: '投递 DCS Cloud 离线分析任务（shell 脚本）—— 用于耗时久、资源大、需并行的任务。支持单命令(-i)或批量文件(-p 每行一条任务，实现并行投递)。',
    parameters: {
      command: { type: 'string', description: '要执行的命令（如 "sh /data/work/test.sh"）；与 batch_file 二选一' },
      batch_file: { type: 'string', description: '批量投递文件路径，每行一条命令生成一个任务（并行）' },
      resource: { type: 'string', required: true, description: '资源规格，如 vf=32g,num_proc=8[,gpu=L4]' },
      image: { type: 'string', required: true, description: '容器镜像 registry 路径（如 stereonote/stereonote_conda_jupyterhub:latest）' },
      name: { type: 'string', description: '任务名称' },
      output_path: { type: 'string', description: '结果输出路径，以 /Files 开头' },
      mount: { type: 'string', description: '挂载数据路径，多个用逗号分隔' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '🚀 离线任务已投递：\n' : '❌ 投递失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 180000,
    async execute(args, exec) {
      return execCli(exec, () => {
        const a = ['analysis', 'run'];
        if (str(args.command)) a.push('-i', str(args.command));
        if (str(args.batch_file)) a.push('-p', str(args.batch_file));
        a.push('-l', str(args.resource));
        a.push('--image', str(args.image));
        if (str(args.name)) a.push('-n', str(args.name));
        if (str(args.output_path)) a.push('-o', str(args.output_path));
        if (str(args.mount)) a.push('-m', str(args.mount));
        return a;
      }, 180000);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_workflow_run',
    description: '投递 DCS Cloud 的 WDL 工作流任务（复用 Genpilot 现有流程）。用 -j json 文件、-e entity + -i 键值对、或 --table 表格三种方式传参。',
    parameters: {
      name: { type: 'string', required: true, description: '工作流名称' },
      version: { type: 'string', description: '流程版本，默认最新' },
      entity: { type: 'string', description: '实体 ID（用 -i 传参时必填）' },
      inputs: { type: 'array', items: { type: 'string' }, description: 'key=value 参数列表，数组参数用 JSON 形式' },
      json_file: { type: 'string', description: '参数 JSON 文件路径（含实体与参数）' },
      table: { type: 'string', description: '参数表格文件路径（.csv/.tsv/.xlsx）' },
      output_path: { type: 'string', description: '结果输出路径，以 /Files 开头' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '🚀 工作流已投递：\n' : '❌ 投递失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 180000,
    async execute(args, exec) {
      return execCli(exec, () => {
        const a = ['workflow', 'run', '-n', str(args.name)];
        if (str(args.version)) a.push('-v', str(args.version));
        if (str(args.entity)) a.push('-e', str(args.entity));
        if (Array.isArray(args.inputs)) for (const kv of args.inputs) a.push('-i', str(kv));
        if (str(args.json_file)) a.push('-j', str(args.json_file));
        if (str(args.table)) a.push('--table', str(args.table));
        if (str(args.output_path)) a.push('-o', str(args.output_path));
        return a;
      }, 180000);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_task_status',
    description: '查询 DCS Cloud 任务状态：离线分析任务(analysis)与 WDL 工作流任务(workflow)。给 task_id 查详情/日志；不给则按条件列任务。',
    parameters: {
      kind: { type: 'string', enum: ['analysis', 'workflow'], required: true, description: '任务类型：analysis=离线任务，workflow=WDL 流程任务' },
      task_id: { type: 'string', description: '任务 ID，提供则查详情与日志' },
      status: { type: 'string', description: '按状态过滤（waiting/running/completed/warning/cancel/error）' },
      name: { type: 'string', description: '按名称过滤' },
      user: { type: 'string', description: '按创建者过滤' },
      all: { type: 'boolean', description: '查询全部' },
      with_log: { type: 'boolean', description: '查详情时是否附带日志' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '📊 任务状态：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 180000,
    async execute(args, exec) {
      const cfg = loadCfg();
      const sig = exec && exec.signal;
      const kind = args.kind || 'analysis';
      try {
        let r;
        if (str(args.task_id)) {
          const infoCmd = kind === 'analysis' ? ['analysis', 'info', str(args.task_id)] : ['workflow', 'task_info', str(args.task_id)];
          const info = await runDcs(cfg, infoCmd, { signal: sig, timeoutMs: 120000 });
          let log = null;
          if (args.with_log) {
            const logCmd = kind === 'analysis' ? ['analysis', 'log', str(args.task_id)] : ['workflow', 'task_log', str(args.task_id)];
            log = await runDcs(cfg, logCmd, { signal: sig, timeoutMs: 120000 });
          }
          r = { ok: info.ok, exit_code: info.exit_code, message: info.message, error: info.error, data: { info: info.data, log: log ? log.data : null }, raw: '', stderr: '', binary: info.binary };
        } else {
          const lsCmd = kind === 'analysis' ? ['analysis', 'ls'] : ['workflow', 'tasks'];
          const a = lsCmd.slice();
          if (args.all) a.push('-a');
          if (str(args.status)) a.push('-s', str(args.status));
          if (str(args.name)) a.push('-n', str(args.name));
          if (str(args.user)) a.push('-u', str(args.user));
          r = await runDcs(cfg, a, { signal: sig, timeoutMs: 120000 });
        }
        return cliView(r);
      } catch (e) {
        return { ok: false, exit_code: 1, message: '', error: String(e && e.message || e), output: String(e && e.message || e), truncated: false, binary: '' };
      }
    },
  }));

  // ---------- 审计 / 报告 ----------

  ctx.tools.register(defineTool({
    name: 'dcs_audit_script',
    description: '在执行前静态审计脚本（shell/python/WDL）：检测危险命令、硬编码密钥、命令注入、资源与镜像配置等，输出分级审计报告（critical/high/medium/low/info）。',
    parameters: {
      path: { type: 'string', description: '本机脚本路径（与 text 二选一）' },
      text: { type: 'string', description: '脚本内容文本（与 path 二选一）' },
      type: { type: 'string', enum: ['auto', 'shell', 'python', 'wdl'], description: '脚本类型，auto 自动识别' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          language: { type: 'string', required: true },
          verdict: { type: 'string', required: true },
          summary: { type: 'json', required: true },
          output: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render(args, v) {
        const head = v.verdict === 'pass' ? '✅ 审计通过：' + v.output.split('\n')[0] : '⚠️ 审计发现风险项：';
        return [{ type: 'text', text: head + '\n' + v.output }];
      },
    },
    async execute(args, exec) {
      let text = str(args.text);
      let src = 'text';
      if (!text && str(args.path)) {
        try {
          const abs = isAbsolute(str(args.path)) ? str(args.path) : join(workspaceOf(exec), str(args.path));
          text = readFileSync(abs, 'utf8');
          src = abs;
        } catch (e) { return { ok: false, language: '', verdict: 'error', summary: {}, output: '读取脚本失败: ' + String(e.message), error: String(e.message) }; }
      }
      if (!text.trim()) return { ok: false, language: '', verdict: 'error', summary: {}, output: '未提供脚本内容或文件为空', error: '空输入' };
      const report = auditScript(text, args.type);
      const lines = ['脚本语言: ' + report.language, '结论: ' + report.verdictLabel, '分级统计: ' + JSON.stringify(report.summary), ''];
      for (const f of report.findings) lines.push('[' + f.severity.toUpperCase() + '] ' + f.message);
      return {
        ok: report.verdict === 'pass',
        language: report.language,
        verdict: report.verdict,
        summary: report.summary,
        output: lines.join('\n') + (report.findings.length === 0 ? '（未发现风险项）' : ''),
        error: '',
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_generate_report',
    description: '将研究方案、方法、结果、图表按学术逻辑整理成自包含的 HTML 网页文件（图片 base64 内嵌），供用户检查。返回网页文件路径。',
    parameters: {
      title: { type: 'string', required: true, description: '报告标题' },
      objective: { type: 'string', description: '研究目标（一句话）' },
      abstract: { type: 'string', description: '摘要（Markdown）' },
      introduction: { type: 'string', description: '引言与背景（Markdown）' },
      methods: { type: 'string', description: '研究方案与方法（Markdown）' },
      results: { type: 'string', description: '结果（Markdown）' },
      discussion: { type: 'string', description: '讨论（Markdown）' },
      references: { type: 'string', description: '参考文献（Markdown）' },
      appendix: { type: 'string', description: '附录（Markdown）' },
      figures: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, caption: { type: 'string' } } }, description: '图表列表，每项 {path: 图片路径, caption: 图注}' },
      author: { type: 'string', description: '作者/单位' },
      output_path: { type: 'string', description: '输出网页路径（可选，默认 ~/.dsh/dcs-reports/）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          path: { type: 'string', required: true },
          figures_embedded: { type: 'integer', required: true },
          total_figures: { type: 'integer', required: true },
          error: { type: 'string' },
        },
      },
      render(args, v) { return [{ type: 'text', text: v.ok ? ('📄 报告已生成：' + v.path + '（内嵌图表 ' + v.figures_embedded + '/' + v.total_figures + '）') : ('❌ 生成失败: ' + (v.error || '')) }]; },
    },
    async execute(args, exec) {
      try {
        const res = generateReport({
          title: args.title,
          objective: args.objective,
          abstract: args.abstract,
          introduction: args.introduction,
          methods: args.methods,
          results: args.results,
          discussion: args.discussion,
          references: args.references,
          appendix: args.appendix,
          figures: Array.isArray(args.figures) ? args.figures : [],
          metadata: { author: args.author, task: args.title },
        }, { workspace: workspaceOf(exec), outPath: str(args.output_path) || undefined });
        return { ok: true, path: res.path, figures_embedded: res.figures, total_figures: res.totalFigures, error: '' };
      } catch (e) {
        return { ok: false, path: '', figures_embedded: 0, total_figures: 0, error: String(e && e.message || e) };
      }
    },
  }));

  // ---------- 通用透传 ----------

  ctx.tools.register(defineTool({
    name: 'dcs_cli',
    description: '直接运行任意 dcs CLI 命令（高级/逃生舱）。args 传子命令与参数（不含 "dcs" 前缀），统一加 --output json。用于上述工具未覆盖的能力，如 project ls、billing ls、table ls、region ls、data copy/move/rm、terminal open/close 等。',
    parameters: {
      args: { type: 'string', required: true, description: 'dcs 子命令与参数，如 "project ls"、"billing ls"、"table ls"、"data rm /Files/old.csv"、"workflow cancel Wxxx"' },
      timeout: { type: 'integer', description: '超时秒数，默认 180' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '✅ dcs 执行结果：\n' : '❌ 失败：' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 300000,
    async execute(args, exec) {
      const argv = str(args.args).trim().split(/\s+/).filter(Boolean);
      if (argv.length === 0) return { ok: false, exit_code: 1, message: '', error: 'args 不能为空', output: 'args 不能为空', truncated: false, binary: '' };
      return execCli(exec, () => argv, (args.timeout || 180) * 1000);
    },
  }));

  // ---------- 数据库全图谱 / Genpilot 能力 ----------

  ctx.tools.register(defineTool({
    name: 'dcs_atlas',
    description: '查看 DCS Cloud「数据库全图谱」：11 个片区（BGI 中心 vs DCS 公共云）的公共库概况、官方组学工具库（8 大类）、关键词→组学类别映射、找数据/找流程优先级与 Genpilot 使用范式。用于快速定位该去哪里找数据、用哪个官方流程。',
    parameters: {
      section: { type: 'string', enum: ['all', 'regions', 'tools', 'keywords', 'datasets', 'hints'], description: '返回哪部分：all=全部（默认），regions=片区公共库，tools=官方工具库，keywords=关键词映射，datasets=容器公共数据集，hints=检索与 Genpilot 使用范式' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: v.output }]; },
    },
    async execute(args) {
      const sec = args.section || 'all';
      const lines = [];
      const fmtRegions = () => {
        lines.push('## 片区（BGI 中心节点公共库更全）');
        lines.push('| 片区 | 类型 | 公共流程 | 官方 DCS | 备注 |');
        lines.push('| --- | --- | --- | --- | --- |');
        for (const r of REGIONS) lines.push('| ' + r.name + ' (' + r.id + ') | ' + (r.type === 'bgi-center' ? 'BGI 中心' : 'DCS 公共云') + ' | ' + (r.publicWorkflows == null ? '需建项目' : r.publicWorkflows) + ' | ' + (r.officialDcs == null ? '-' : r.officialDcs) + ' | ' + r.note + ' |');
      };
      const fmtTools = () => {
        lines.push('## 官方组学工具库（dcs project omics_tools）');
        for (const c of OMICS_TOOLS) {
          lines.push('### ' + c.label + '（' + c.code + '，' + c.tools.length + ' 个官方流程）');
          lines.push(c.tools.length ? c.tools.join(', ') : '（暂无官方流程）');
        }
      };
      const fmtKeywords = () => {
        lines.push('## 关键词 → 组学类别映射');
        for (const k of KEYWORD_TO_CATEGORY) lines.push('- ' + k.category + ' ← ' + k.keywords.join('/'));
      };
      const fmtDatasets = () => {
        lines.push('## 在线容器公共数据集（/public/database/CNGBdb）');
        lines.push('| 编号 | 名称 | 说明 |');
        lines.push('| --- | --- | --- |');
        for (const d of PUBLIC_DATASETS) lines.push('| ' + d.code + ' | ' + d.name + ' | ' + d.note + ' |');
      };
      if (sec === 'all' || sec === 'regions') fmtRegions();
      if (sec === 'all' || sec === 'tools') { if (sec === 'all') lines.push(''); fmtTools(); }
      if (sec === 'all' || sec === 'keywords') { if (sec === 'all') lines.push(''); fmtKeywords(); }
      if (sec === 'all' || sec === 'datasets') { if (sec === 'all') lines.push(''); fmtDatasets(); }
      if (sec === 'all' || sec === 'hints') { if (sec === 'all') lines.push(''); lines.push('## 检索优先级\n' + searchHints()); lines.push('\n## Genpilot 使用范式\n' + genpilotHints()); lines.push('\n## 容器公共数据\n' + containerHints()); }
      return { ok: true, output: lines.join('\n'), error: '' };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_public_search',
    description: '直接搜索 DCS 公共库（公共数据/公共流程/公共项目/AI模型）。这是找公共数据最快的方式（dcs CLI 无此命令，走公共库 REST API）。按名称关键词检索，返回 resType 区分 dataset/workflow/proj/img/ai_model。需先 dcs_login（PAT）。',
    parameters: {
      name: { type: 'string', required: true, description: '名称关键词，如 "embryo"、"mouse"、"MOSTA"、"时空"、"Stereo-seq"' },
      page: { type: 'integer', description: '页码，默认 1' },
      page_size: { type: 'integer', description: '每页条数，默认 30' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, total: { type: 'integer', required: true }, output: { type: 'string', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '🔍 公共库检索（共 ' + v.total + ' 条）：\n' : '❌ ' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 90000,
    async execute(args, exec) {
      const cfg = loadCfg();
      try {
        const r = await publicSearch(cfg, str(args.name), { page: args.page, pageSize: args.page_size || 30, signal: exec && exec.signal });
        const lines = r.records.map((x) => {
          const t = { dataset: '📊数据集', workflow: '🧬流程', proj: '📁项目', img: '🖼️镜像', ai_model: '🤖AI模型', tool_interactive: '🛠️工具', workspace_notebook: '📓notebook' }[x.resType] || x.resType;
          return t + ' ' + x.name + '（zone=' + x.zone + '，id=' + x.id + '）' + (x.intro ? ' — ' + x.intro : '');
        });
        return { ok: true, total: r.total, output: lines.join('\n') || '（无结果）', error: '' };
      } catch (e) {
        return { ok: false, total: 0, output: '', error: String(e && e.message || e) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_container_ls',
    description: '列出 DCS 在线容器内的目录/文件（加速找公共数据与结果）。默认列 /public（公共库挂载：database/demo/reference/tools）；也可列 /work/{user} 看已有分析、或 /public/database/CNGBdb/pub/SciRAID/stomics/ 看公共数据集。',
    parameters: {
      path: { type: 'string', description: '容器内路径，默认 /public' },
      max_depth: { type: 'integer', description: 'find 递归深度（可选，默认只列一层）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '📁 容器目录：\n' : '❌ ' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      const cfg = loadCfg();
      const p = str(args.path) || '/public';
      const depth = args.max_depth ? ' -maxdepth ' + Math.max(1, Math.floor(args.max_depth)) : '';
      const cmd = args.max_depth ? 'find ' + p + depth + ' 2>/dev/null | head -100' : 'ls -la ' + p + ' 2>/dev/null';
      try {
        let r = await runDcs(cfg, ['terminal', 'exec', '-c', cmd, '--timeout', '100'], { signal: exec && exec.signal, timeoutMs: 110000 });
        if (!r.ok && /83006|83007|容器|workspace|not open|open/i.test(r.error + ' ' + r.raw)) {
          await runDcs(cfg, ['terminal', 'open'], { signal: exec && exec.signal, timeoutMs: 180000 });
          await new Promise((res) => setTimeout(res, 4000));
          r = await runDcs(cfg, ['terminal', 'exec', '-c', cmd, '--timeout', '100'], { signal: exec && exec.signal, timeoutMs: 110000 });
        }
        const out = r.ok ? r.raw : (r.error || r.stderr || '');
        return { ok: r.ok, output: out.slice(0, OUTPUT_CAP), error: r.ok ? '' : (r.error || '') };
      } catch (e) {
        return { ok: false, output: '', error: String(e && e.message || e) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_data_inspect',
    description: '快速查看容器内 h5ad（AnnData 单细胞/时空数据）或 csv 的结构：维度、obs 列（细胞类型 annotation / 脑区 region 等唯一值）、var 列（基因）。用 h5py 只读元数据，不加载表达矩阵，速度快。',
    parameters: {
      path: { type: 'string', required: true, description: '容器内 h5ad 或 csv 绝对路径，如 /public/.../E16.5_E1S3_cell_bin_whole_brain.h5ad' },
      obs_columns: { type: 'string', description: '要看的 obs 列（逗号分隔），默认 annotation,region,Slice' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '🔬 数据结构：\n' : '❌ ' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 240000,
    async execute(args, exec) {
      const cfg = loadCfg();
      const p = str(args.path);
      const cols = (str(args.obs_columns) || 'annotation,region,Slice').split(',').map((s) => s.trim()).filter(Boolean);
      const pyCols = cols.map((c) => JSON.stringify(c)).join(',');
      const py = `import h5py, numpy as np
p=${JSON.stringify(p)}
f=h5py.File(p,'r')
print('shape: obs=', f['obs']['_index'].shape[0], 'var=', f['var']['_index'].shape[0])
print('obs keys:', list(f['obs'].keys()))
print('var keys:', list(f['var'].keys()))
for k in [${pyCols}]:
    if k in f['obs']:
        d=f['obs'][k]
        if 'categories' in d:
            cats=[c.decode() if isinstance(c,bytes) else c for c in d['categories'][:]]
            vals=[cats[i] for i in d['codes'][:]]
        else:
            v=d[()]
            vals=[x.decode() if isinstance(x,bytes) else x for x in v]
        uniq,cnt=np.unique(vals,return_counts=True)
        order=np.argsort(-cnt)
        print('obs['+k+'] nunique='+str(len(uniq))+' -> '+str([(uniq[i],int(cnt[i])) for i in order[:20]]))
f.close()`;
      try {
        let r = await runDcs(cfg, ['terminal', 'exec', '-c', "python3 - <<'PYEOF'\n" + py + "\nPYEOF", '--timeout', '220'], { signal: exec && exec.signal, timeoutMs: 230000 });
        if (!r.ok && /83006|83007|容器|workspace|not open|open/i.test(r.error + ' ' + r.raw)) {
          await runDcs(cfg, ['terminal', 'open'], { signal: exec && exec.signal, timeoutMs: 180000 });
          await new Promise((res) => setTimeout(res, 4000));
          r = await runDcs(cfg, ['terminal', 'exec', '-c', "python3 - <<'PYEOF'\n" + py + "\nPYEOF", '--timeout', '220'], { signal: exec && exec.signal, timeoutMs: 230000 });
        }
        const out = r.ok ? r.raw : (r.error || r.stderr || '');
        return { ok: r.ok, output: out.slice(0, OUTPUT_CAP), error: r.ok ? '' : (r.error || '') };
      } catch (e) {
        return { ok: false, output: '', error: String(e && e.message || e) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_find_results',
    description: '查找 DCS 在线容器 /work/{user} 下已有的分析结果目录/文件（Genpilot 或之前会话已跑的分析），避免重复计算。返回目录树与 csv/png/html 产物清单。',
    parameters: {
      user: { type: 'string', description: '用户名，默认当前用户' },
      keyword: { type: 'string', description: '按关键词过滤目录名，如 RNA、variant、brain' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, output: { type: 'string', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '📂 已有分析结果：\n' : '❌ ' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      const cfg = loadCfg();
      const u = str(args.user) || 'xuxun';
      const kw = str(args.keyword);
      const cmd = "find /work/" + u + " -maxdepth 2 -type d 2>/dev/null | grep -v __pycache__ | head -60; echo '--- 产物文件(csv/png/html) ---'; find /work/" + u + " -maxdepth 3 -type f \\( -name '*.csv' -o -name '*.png' -o -name '*.html' -o -name '*.npz' \\) 2>/dev/null | head -40";
      try {
        let r = await runDcs(cfg, ['terminal', 'exec', '-c', cmd, '--timeout', '100'], { signal: exec && exec.signal, timeoutMs: 110000 });
        if (!r.ok && /83006|83007|容器|workspace|not open|open/i.test(r.error + ' ' + r.raw)) {
          await runDcs(cfg, ['terminal', 'open'], { signal: exec && exec.signal, timeoutMs: 180000 });
          await new Promise((res) => setTimeout(res, 4000));
          r = await runDcs(cfg, ['terminal', 'exec', '-c', cmd, '--timeout', '100'], { signal: exec && exec.signal, timeoutMs: 110000 });
        }
        let out = r.ok ? r.raw : (r.error || r.stderr || '');
        if (kw && r.ok) { out = out.split('\n').filter((l) => l.toLowerCase().includes(kw.toLowerCase())).join('\n') || '（无匹配 ' + kw + '）'; }
        return { ok: r.ok, output: out.slice(0, OUTPUT_CAP), error: r.ok ? '' : (r.error || '') };
      } catch (e) {
        return { ok: false, output: '', error: String(e && e.message || e) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_llm',
    description: '调用 DCS 系统自带的 Genpilot LLM（模型自动选择，无需额外 API key，鉴权由在线容器环境自动注入）做变异解读、文献综合、方案撰写、论文润色等。在 DCS 在线容器内执行。',
    parameters: {
      prompt: { type: 'string', required: true, description: '用户提问/要完成的任务' },
      system: { type: 'string', description: '系统提示词（角色设定），可选' },
      model: { type: 'string', description: '模型名，可选；缺省由系统自动选择（默认 deepseek-v4-pro）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          model: { type: 'string', required: true },
          content: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render(args, v) { return [{ type: 'text', text: v.ok ? ('🤖 Genpilot LLM：\n' + v.content) : ('❌ 失败: ' + (v.error || '')) }]; },
    },
    timeoutMs: 360000,
    async execute(args, exec) {
      const cfg = loadCfg();
      const sig = exec && exec.signal;
      const payload = { system: str(args.system), prompt: str(args.prompt), model: str(args.model) };
      const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
      const py = `
import os, json, base64, urllib.request, urllib.error
def load_env(path):
    d = {}
    try:
        for line in open(path):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                d[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return d
env = {}
for p in ['.env', '/work/' + os.environ.get('USER', '') + '/.env']:
    env.update(load_env(p))
env.update({k: v for k, v in os.environ.items()})
base = os.environ.get('LLM_API_BASE') or env.get('LLM_API_BASE') or 'https://dcsapi.dcs.cloud/api/aigress/unified/v1/chat/completions'
model = env.get('LLM_MODEL') or 'deepseek-v4-pro'
key = os.environ.get('LLM_API_KEY') or env.get('LLM_API_KEY') or env.get('DCS_X_ACCESS_TOKEN') or ''
data = json.loads(base64.b64decode('${b64}').decode())
if data.get('model'):
    model = data['model']
msgs = []
if data.get('system'):
    msgs.append({'role': 'system', 'content': data['system']})
msgs.append({'role': 'user', 'content': data['prompt']})
body = json.dumps({'model': model, 'messages': msgs})
req = urllib.request.Request(base, data=body.encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
try:
    r = urllib.request.urlopen(req, timeout=180)
    d = json.loads(r.read())
    print('__MODEL__' + d.get('model', model))
    print(d['choices'][0]['message']['content'])
except urllib.error.HTTPError as e:
    print('__DCS_LLM_ERR__ ' + str(e.code) + ' ' + e.read().decode()[:300])
except Exception as e:
    print('__DCS_LLM_ERR__ ' + str(e)[:300])
`;
      const cmd = "python3 - <<'PYEOF'\n" + py + "\nPYEOF";
      const run = () => runDcs(cfg, ['terminal', 'exec', '-c', cmd, '--timeout', '300'], { signal: sig, timeoutMs: 320000 });
      try {
        let r = await run();
        if (!r.ok && /83006|83007|容器|workspace|not open|open/i.test(r.error + ' ' + r.raw)) {
          await runDcs(cfg, ['terminal', 'open'], { signal: sig, timeoutMs: 180000 });
          await new Promise((res) => setTimeout(res, 4000));
          r = await run();
        }
        const out = r.ok ? r.raw : (r.stderr || r.error || '');
        const errIdx = out.indexOf('__DCS_LLM_ERR__');
        if (errIdx !== -1) {
          return { ok: false, model: '', content: '', error: out.slice(errIdx + 16).trim() };
        }
        const mIdx = out.indexOf('__MODEL__');
        let model = 'deepseek-v4-pro';
        let content = out;
        if (mIdx !== -1) {
          const nl = out.indexOf('\n', mIdx);
          model = out.slice(mIdx + 9, nl === -1 ? out.length : nl).trim() || model;
          content = out.slice(nl === -1 ? out.length : nl + 1).trim();
        }
        return { ok: true, model, content: content || '(空响应)', error: '' };
      } catch (e) {
        return { ok: false, model: '', content: '', error: String(e && e.message || e) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_parallel_run',
    description: '并行投递多条离线任务（Genpilot 分片并行范式：command_template 里 {i} 会被替换为 0..count-1，每条生成一个独立离线任务并立即返回）。用于把大数据量分析按 shard 并行加速。',
    parameters: {
      command_template: { type: 'string', required: true, description: '命令模板，{i} 为分片序号占位符，如 "bash /work/xuxun/proj/scripts/step.sh {i}" 或 "python3 step.py --shard {i} --total 4"' },
      count: { type: 'integer', required: true, description: '并行任务数（分片数）' },
      resource: { type: 'string', required: true, description: '资源规格，如 vf=32g,num_proc=8[,gpu=L4]' },
      image: { type: 'string', required: true, description: '镜像 registry 路径，常用 ubuntu:24.04-python3.12' },
      name: { type: 'string', description: '任务名前缀' },
      output_path: { type: 'string', description: '结果输出路径，以 /Files 开头' },
      mount: { type: 'string', description: '挂载数据路径，逗号分隔' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          submitted: { type: 'integer', required: true },
          output: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render(args, v) { return [{ type: 'text', text: (v.ok ? '🚀 已并行投递 ' + v.submitted + ' 条离线任务：\n' : '❌ 失败: ' + (v.error || '') + '\n') + v.output }]; },
    },
    timeoutMs: 600000,
    async execute(args, exec) {
      const cfg = loadCfg();
      const sig = exec && exec.signal;
      const count = Math.max(1, Math.min(64, Math.floor(args.count || 1)));
      const tpl = str(args.command_template);
      const results = [];
      let submitted = 0;
      for (let i = 0; i < count; i++) {
        const cmd = tpl.indexOf('{i}') !== -1 ? tpl.split('{i}').join(String(i)) : tpl;
        const a = ['analysis', 'run', '-i', cmd, '-l', str(args.resource), '--image', str(args.image)];
        if (str(args.name)) a.push('-n', str(args.name) + '-' + i);
        if (str(args.output_path)) a.push('-o', str(args.output_path));
        if (str(args.mount)) a.push('-m', str(args.mount));
        try {
          const r = await runDcs(cfg, a, { signal: sig, timeoutMs: 120000 });
          const tid = r.ok && r.data ? (r.data.task_id || r.data.taskId || r.data.parent_task_id || (Array.isArray(r.data) ? r.data[0] : null) || '') : '';
          if (r.ok) submitted++;
          results.push('分片 ' + i + ': ' + (r.ok ? ('✅ 已投递 ' + (tid || '') + ' ' + (r.message || '')) : ('❌ ' + (r.error || r.message || '投递失败'))) + '  [' + cmd.slice(0, 60) + ']');
        } catch (e) {
          results.push('分片 ' + i + ': ❌ ' + String(e && e.message || e));
        }
      }
      return { ok: submitted === count, submitted, output: results.join('\n'), error: '' };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_plan',
    description: '生成/更新 DCS Genpilot 风格的 Plan.md 执行计划文档（步骤进度表 + 产物路径汇总 + 方法学 + 总结），作为研究方案与过程追踪的活文档。',
    parameters: {
      title: { type: 'string', required: true, description: '计划标题（研究任务名）' },
      steps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { status: { type: 'string' }, desc: { type: 'string', required: true }, detail: { type: 'string' } } }, description: '步骤列表 [{status: 完成/进行中/待执行, desc: 步骤描述, detail: 进度详情}]' },
      outputs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, path: { type: 'string' }, desc: { type: 'string' } } }, description: '产物列表 [{name, path, desc}]' },
      methodology: { type: 'string', description: '计算科学方法学概述（Markdown）' },
      summary: { type: 'string', description: '执行总结（Markdown）' },
      output_path: { type: 'string', description: '输出路径（可选，默认 ~/.dsh/dcs-plans/）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, path: { type: 'string', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: v.ok ? ('📝 Plan.md 已生成：' + v.path) : ('❌ 失败: ' + (v.error || '')) }]; },
    },
    async execute(args, exec) {
      try {
        const res = generatePlan({
          title: args.title,
          steps: Array.isArray(args.steps) ? args.steps : [],
          outputs: Array.isArray(args.outputs) ? args.outputs : [],
          methodology: args.methodology,
          summary: args.summary,
        }, { workspace: workspaceOf(exec), outPath: str(args.output_path) || undefined });
        return { ok: true, path: res.path, error: '' };
      } catch (e) {
        return { ok: false, path: '', error: String(e && e.message || e) };
      }
    },
  }));

  // ---------- DCS 任务面板（数据写入工具） ----------

  ctx.tools.register(defineTool({
    name: 'dcs_task_update',
    description: '创建/更新「DCS 任务」面板里的分析任务：记录分析计划、数据源、各步骤（含依赖关系=逻辑关系、状态、进度、细节）。写入后浏览器「DCS 任务」tab 实时显示。这是把分析过程可视化、追踪进展的入口。',
    parameters: {
      task_id: { type: 'string', description: '任务 ID（更新已有任务时提供；省略则新建）' },
      title: { type: 'string', required: true, description: '任务标题' },
      objective: { type: 'string', description: '研究目标（一句话）' },
      data_sources: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, path: { type: 'string' }, type: { type: 'string' }, desc: { type: 'string' } } }, description: '数据源列表 [{name, path, type, desc}]' },
      steps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, title: { type: 'string', required: true }, status: { type: 'string', enum: ['pending', 'running', 'done', 'failed', 'blocked'] }, detail: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' } }, outputs: { type: 'array', items: { type: 'string' } }, deliverables: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, type: { type: 'string', enum: ['dataset', 'result', 'chart', 'report', 'file'] }, path: { type: 'string' }, desc: { type: 'string' } } } }, progress: { type: 'integer' } } }, description: '分析步骤列表 [{id, title, status, detail, dependsOn(依赖步骤id=逻辑关系), outputs, deliverables(交付物[{name,type(dataset/result/chart/report/file),path,desc}]), progress(0-100)}]' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          task_id: { type: 'string', required: true },
          n_steps: { type: 'integer', required: true },
          error: { type: 'string' },
        },
      },
      render(args, v) { return [{ type: 'text', text: v.ok ? ('✅ DCS 任务已更新：' + v.task_id + '（' + v.n_steps + ' 步），浏览器「DCS 任务」tab 可查看') : ('❌ 失败: ' + (v.error || '')) }]; },
    },
    async execute(args) {
      try {
        const r = upsertTask(args);
        return { ok: true, task_id: r.task.id, n_steps: r.task.steps.length, error: '' };
      } catch (e) {
        return { ok: false, task_id: '', n_steps: 0, error: String(e && e.message || e) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dcs_step_status',
    description: '轻量更新「DCS 任务」面板中单个步骤的状态/进度/细节（agent 逐步推进时调用，无需重传全部步骤）。',
    parameters: {
      task_id: { type: 'string', required: true, description: '任务 ID' },
      step_id: { type: 'string', required: true, description: '步骤 ID' },
      status: { type: 'string', enum: ['pending', 'running', 'done', 'failed', 'blocked'], description: '新状态' },
      detail: { type: 'string', description: '更新细节说明' },
      progress: { type: 'integer', description: '进度 0-100' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, error: { type: 'string' } } },
      render(args, v) { return [{ type: 'text', text: v.ok ? '✅ 步骤状态已更新' : ('❌ ' + (v.error || '')) }]; },
    },
    async execute(args) {
      const r = updateStepStatus(str(args.task_id), str(args.step_id), args.status, args.detail, args.progress);
      return { ok: r.ok, error: r.error || '' };
    },
  }));

  // ---------- DCS 任务面板 HTTP 路由（供浏览器 tab 读取） ----------

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/dcs-cloud',
    handler: async (req, res) => {
      const url = new URL(req.url || '', 'http://localhost');
      const path = url.pathname.replace(/^\/api\/dcs-cloud/, '') || '/';
      const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      try {
        if (req.method === 'GET' && (path === '/' || path === '/tasks')) {
          json(200, { ok: true, tasks: loadTasks() });
          return;
        }
        if (req.method === 'GET' && path.startsWith('/tasks/')) {
          const id = decodeURIComponent(path.slice('/tasks/'.length));
          const t = getTask(id);
          if (t) json(200, { ok: true, task: t });
          else json(404, { ok: false, error: '任务不存在' });
          return;
        }
        if (req.method === 'POST' && path === '/tasks') {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size > 1024 * 1024) { req.destroy(); return; } chunks.push(c); });
          req.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
              const r = upsertTask(body);
              json(200, { ok: true, task: r.task });
            } catch (e) { json(400, { ok: false, error: String(e.message) }); }
          });
          req.on('error', () => {});
          return;
        }
        json(404, { ok: false, error: 'not found' });
      } catch (e) {
        json(500, { ok: false, error: String(e && e.message || e) });
      }
    },
  }));

  // ---------- 编排引导（systemPrompt） ----------

  ctx.systemPrompt.section({
    name: 'dcs-cloud',
    order: 160,
    text: () => `【DCS 云研究】本会话已接入 DCS Cloud（通过 dcs CLI，https://github.com/BGIResearch/dcs_cli）。执行生信/时空组学研究开发任务时遵循以下流程：
1. 定方向：用 dcs_atlas 查「数据库全图谱」（片区公共库 + 官方组学工具库 + 关键词映射 + 容器公共数据集）。
2. 找数据（加速）：公共数据集先用 dcs_public_search 搜公共库、dcs_container_ls 列 /public/database/CNGBdb 目录定位；用 dcs_data_inspect 看 h5ad 结构（细胞类型/基因）；避免重复：先 dcs_find_results 看 /work 里 Genpilot 是否已跑过。
3. 任务分解与追踪：拆成可并行子任务；用 dcs_task_update 把「分析计划 + 数据源 + 各步骤依赖关系 + 进展」写入「DCS 任务」面板（浏览器 tab 实时显示），推进时用 dcs_step_status 更新单步状态；也可用 dcs_plan 生成 Plan.md。
4. 深度研究：用 web_search / 子代理检索文献；需求不明用 ask_user_question 与客户确认，形成研究方案。
5. 数据资源（第一优先级）：dcs_public_search / dcs_container_ls / dcs_data_find 在 DCS 公共库与 /Files 检索；不足时（第二优先级）dcs_data_download 外部下载。
6. 脚本/方案（第一优先级）：dcs_workflow_search / dcs_workflow_info 复用 Genpilot 现有流程；不足时（第二优先级）在容器写 stepN_*.py（密钥系统自动注入）。
7. 审计：dcs_audit_script 审计脚本，确认无 critical/high 风险。
8. 执行：长任务/并行 → dcs_offline_run / dcs_parallel_run 或 dcs_workflow_run；简单任务 → dcs_terminal_exec。标准镜像 ubuntu:24.04-python3.12、资源 4c 16g。用 dcs_task_status 跟踪。
9. 解读与写作：用 dcs_llm 调 DCS 系统自带 Genpilot LLM（自动选模型）做解读/文献综合/论文写作。
10. 报告：用 dcs_generate_report 出 HTML 网页、dcs_plan 更新 Plan.md，按学术逻辑交付。
- 登录/状态：首次用 dcs_login（PAT），用 dcs_status 看当前项目/片区。`,
  });
}
