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
  loadCfg, saveCfg, runDcs, dcsLogin, dcsStatus,
  resolveDcsBinary, platformBinary, DCS_VERSION,
} from './dcs-client.js';
import { auditScript } from './audit.js';
import { generateReport } from './report.js';

/** Cordis 插件名 —— 必须与 cordis.patch.yml 里的行 id 一致。 */
export const name = 'dsh-dcs-cloud';

/** 硬依赖的宿主服务。 */
export const inject = ['tools', 'systemPrompt'];

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
    description: '配置 dcs CLI 的本地参数（cliPath 二进制路径、autoInstall 自动下载开关）。PAT 登录请用 dcs_login。',
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
      render(args, v) { return [{ type: 'text', text: v.ok ? ('✅ dcs 配置已保存：cliPath=' + v.cliPath + '，autoInstall=' + v.autoInstall + '（平台 ' + v.platform + '）') : ('❌ 配置失败: ' + (v.error || '')) }]; },
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

  // ---------- 编排引导（systemPrompt） ----------

  ctx.systemPrompt.section({
    name: 'dcs-cloud',
    order: 160,
    text: () => `【DCS 云研究】本会话已接入 DCS Cloud（通过 dcs CLI，https://github.com/BGIResearch/dcs_cli）。执行生信/时空组学研究开发任务时遵循以下流程：
1. 任务分解：把任务拆成可并行的子任务（可用 dcs_workflow_info 的 plan 做多步流程规划）。
2. 深度研究：用 web_search / 子代理检索文献与方法；需求不明时用 ask_user_question 与客户确认，最终形成研究方案（目标/方法/数据/脚本/执行计划）。
3. 数据资源（第一优先级）：用 dcs_data_find / dcs_data_ls 在 DCS 平台数据（/Files 公共库与项目数据）中检索；不足时（第二优先级）用 dcs_data_download 获取外部数据。
4. 脚本/方案（第一优先级）：用 dcs_workflow_search / dcs_workflow_info 复用 Genpilot 现有流程与参数；不足时（第二优先级）用 dcs_terminal_file 编写新脚本。
5. 审计：执行前用 dcs_audit_script 审计所有脚本与流程，确认无 critical/high 风险后再执行。
6. 执行：耗时久/资源大/需并行 → dcs_offline_run（离线投递，-p 批量并行）或 dcs_workflow_run；简单任务 → dcs_terminal_exec 在线运行。尽量并行推进，用 dcs_task_status 跟踪。
7. 报告：用 dcs_generate_report 把结果、图表、方法、思路按学术逻辑整理成网页文件供检查。
- 登录/状态：首次用 dcs_login（PAT），用 dcs_status 查看当前项目/片区。`,
  });
}
