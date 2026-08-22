// dsh-dcs-cloud v2.0 — DCS Harness 项目/模块/运行/交付 存储（Host 侧，纯 Node）。
// 支撑 DCS Harness 独立页面的三个窗口：
//   - 任务交互：项目的任务分解（modules）+ 执行状态
//   - 项目管理：模块的运行版本（每次重跑新增一个 Run）、文件清单、资源消耗（dsh tokens + dcs 费用）
//   - 结果交付：论文式交付文档（8 个章节），关键节点整体梳理更新（revision 递增）
// 持久化于 ~/.dsh/dcs-projects.json，按 sessionId 作用域（每个对话一个项目）。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const VALID_STATUS = ['pending', 'running', 'done', 'failed', 'blocked'];
const VALID_FILE_KINDS = ['code', 'input', 'output'];
// 交付文档章节（论文写作逻辑顺序）
export const DELIVERY_SECTIONS = [
  'question',      // 科学问题
  'hypothesis',    // 科学假说
  'decomposition', // 科学问题分解（可检验子问题）
  'data',          // 原始数据
  'methods',       // 分析方法
  'findings',      // 科学发现与主要结论
  'novelty',       // 创新性与已有科研结果的关系
  'nextSteps',     // 下一步计划与建议
];

export function projectsPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dcs-projects.json');
}

// ---- 进程内互斥锁：串行化 dcs-projects.json 的读-改-写，避免多会话并发覆盖 ----
// 用 Promise 链实现：每个写操作排队，前一个完成后才执行下一个，保证读-改-写原子。
let projectLockChain = Promise.resolve();
export function withProjectLock(work) {
  const run = projectLockChain.then(work, work);
  // 无论成败都释放锁，且不把一次失败传给下一次
  projectLockChain = run.catch(() => {});
  return run;
}

function loadAll() {
  try {
    const d = JSON.parse(readFileSync(projectsPath(), 'utf8'));
    if (Array.isArray(d)) return d; // 兼容旧格式：裸数组
    return Array.isArray(d && d.projects) ? d.projects : [];
  } catch {
    return [];
  }
}

function saveAll(projects) {
  mkdirSync(dirname(projectsPath()), { recursive: true });
  writeFileSync(projectsPath(), JSON.stringify({ projects }, null, 2));
}

// ---- 归一化 ----

function normFile(f, kind) {
  return {
    name: String(f.name || f.path || ''),
    path: String(f.path || f.name || ''),
    desc: String(f.desc || ''),
    kind: VALID_FILE_KINDS.includes(f.kind) ? f.kind : kind,
    size: typeof f.size === 'number' ? f.size : null,
    mtime: f.mtime ? String(f.mtime) : '',
  };
}

function normFiles(files) {
  const out = { code: [], input: [], output: [] };
  if (!files || typeof files !== 'object') return out;
  for (const kind of VALID_FILE_KINDS) {
    const list = Array.isArray(files[kind]) ? files[kind] : [];
    out[kind] = list.map((f) => normFile(f, kind));
  }
  return out;
}

function normRun(r, version) {
  return {
    id: String(r.id || 'run-' + Math.random().toString(36).slice(2, 8)),
    version: version || String(r.version || 1),
    status: VALID_STATUS.includes(r.status) ? r.status : 'running',
    startedAt: r.startedAt || Date.now(),
    finishedAt: r.finishedAt || null,
    dcsTaskIds: Array.isArray(r.dcsTaskIds) ? r.dcsTaskIds.map(String) : (r.dcs_task_ids ? r.dcs_task_ids.map(String) : []),
    files: normFiles(r.files),
    dcsCost: typeof r.dcsCost === 'number' ? r.dcsCost : (typeof r.dcs_cost === 'number' ? r.dcs_cost : null),
    dshTokens: typeof r.dshTokens === 'number' ? r.dshTokens : (typeof r.dsh_tokens === 'number' ? r.dsh_tokens : null),
    progress: typeof r.progress === 'number' ? Math.max(0, Math.min(100, Math.floor(r.progress))) : (r.status === 'done' ? 100 : (r.status === 'running' ? 50 : 0)),
    notes: String(r.notes || ''),
  };
}

function normModule(m) {
  return {
    id: String(m.id || 'module-' + Math.random().toString(36).slice(2, 8)),
    name: String(m.name || m.title || '未命名模块'),
    desc: String(m.desc || ''),
    status: VALID_STATUS.includes(m.status) ? m.status : 'pending',
    createdAt: m.createdAt || Date.now(),
    updatedAt: m.updatedAt || Date.now(),
    runs: Array.isArray(m.runs) ? m.runs.map((r, i) => normRun(r, r.version || String(i + 1))) : [],
  };
}

function normDelivery(d) {
  const sections = {};
  for (const key of DELIVERY_SECTIONS) {
    sections[key] = String((d && d.sections && d.sections[key]) || '');
  }
  return {
    updatedAt: (d && d.updatedAt) || 0,
    revision: (d && d.revision) || 0,
    sections,
    charts: Array.isArray(d && d.charts) ? d.charts : [],
  };
}

// 兼容旧数据：把 genomes/annotations/other 三项合并为自由 items 列表
function buildItemsFromLegacy(cd) {
  const out = [];
  const add = (arr, prefix) => {
    if (Array.isArray(arr)) for (const x of arr) {
      const s = String(x || '');
      if (s) out.push({ path: s, desc: prefix });
    }
  };
  add(cd && cd.genomes, '基因组');
  add(cd && cd.annotations, '注释');
  add(cd && cd.other, '其他');
  return out;
}

function normProject(p, sessionId) {
  return {
    id: String(p.id || 'project-' + Math.random().toString(36).slice(2, 8)),
    sessionId: String(p.sessionId || sessionId || ''),
    title: String(p.title || '未命名 DCS 研究项目'),
    objective: String(p.objective || ''),
    model: String(p.model || 'auto'),
    resources: String(p.resources || ''),
    region: String(p.region || ''), // 项目关联的 DCS 节点（片区）
    status: VALID_STATUS.includes(p.status) ? p.status : 'pending',
    // Phase3：用户自定义数据地址（自由输入，不限类型；每项 {path, desc}，向右兼容旧 genomes/annotations/other）
    customData: {
      items: Array.isArray(p.customData && p.customData.items)
        ? p.customData.items.map((it) => ({ path: String((it && it.path) || ''), desc: String((it && it.desc) || '') }))
        : buildItemsFromLegacy(p.customData),
      note: String((p.customData && p.customData.note) || ''),
      genomes: Array.isArray(p.customData && p.customData.genomes) ? p.customData.genomes.map(String) : [],
      annotations: Array.isArray(p.customData && p.customData.annotations) ? p.customData.annotations.map(String) : [],
      other: Array.isArray(p.customData && p.customData.other) ? p.customData.other.map(String) : [],
    },
    // Phase3：分析计划（规划阶段）+ 互动状态（drafting 草拟中 / awaiting_review 待确认 / approved 已批准）
    plan: {
      content: String((p.plan && p.plan.content) || ''),
      planStatus: String((p.plan && p.plan.planStatus) || 'drafting'),
      stepIds: Array.isArray(p.plan && p.plan.stepIds) ? p.plan.stepIds.map(String) : [],
      updatedAt: (p.plan && p.plan.updatedAt) || 0,
    },
    // Phase3：里程碑质检（关键节点质检清单），每项 {name, status, check, updatedAt}
    milestones: Array.isArray(p.milestones) ? p.milestones.map(normMilestone) : [],
    createdAt: p.createdAt || Date.now(),
    updatedAt: p.updatedAt || Date.now(),
    modules: Array.isArray(p.modules) ? p.modules.map(normModule) : [],
    delivery: normDelivery(p.delivery),
  };
}

// 里程碑质检项归一化
function normMilestone(m) {
  return {
    name: String((m && m.name) || '里程碑'),
    status: VALID_STATUS.includes(m && m.status) ? m.status : 'pending',
    check: String((m && m.check) || ''),
    updatedAt: (m && m.updatedAt) || 0,
  };
}

// ---- 读取 ----

export function listProjects(sessionId) {
  const all = loadAll();
  return sessionId ? all.filter((p) => p.sessionId === sessionId) : all;
}

export function getProject(projectId, sessionId) {
  const all = loadAll();
  return all.find((p) => p.id === projectId && (!sessionId || p.sessionId === sessionId)) || null;
}

function projectIndex(projectId, sessionId) {
  return loadAll().findIndex((p) => p.id === projectId && (!sessionId || p.sessionId === sessionId));
}

// ---- 写操作 ----

/** 创建或更新项目级信息（标题/目标/模型/资源/状态）。 */
export async function upsertProject(input, sessionId) {
  return withProjectLock(() => {
    const sid = sessionId || input.sessionId || '';
    const all = loadAll();
    const now = Date.now();
    let idx;
    if (input.project_id || input.task_id) {
      idx = all.findIndex((p) => p.id === String(input.project_id || input.task_id) && (!sid || p.sessionId === sid));
    } else {
      idx = -1;
    }
    let project;
    if (idx >= 0) {
      project = normProject({ ...all[idx], ...input, updatedAt: now }, sid);
      project.createdAt = all[idx].createdAt || now;
      all[idx] = project;
    } else {
      project = normProject({ ...input, id: input.project_id || input.task_id || undefined, createdAt: now, updatedAt: now }, sid);
      all.unshift(project);
    }
    saveAll(all.slice(0, 200));
    return project;
  });
}

/** 更新项目的轻量字段（如模型选择），不影响模块与交付。 */
export async function mergeProject(projectId, patch, sessionId) {
  return withProjectLock(() => {
    const idx = projectIndex(projectId, sessionId);
    if (idx < 0) return { ok: false, error: '项目不存在: ' + projectId };
    const all = loadAll();
    const p = all[idx];
    if (patch.title !== undefined) p.title = String(patch.title);
    if (patch.objective !== undefined) p.objective = String(patch.objective);
    if (patch.model !== undefined) p.model = String(patch.model);
    if (patch.resources !== undefined) p.resources = String(patch.resources);
    if (patch.region !== undefined) p.region = String(patch.region);
    if (patch.status !== undefined && VALID_STATUS.includes(patch.status)) p.status = patch.status;
    // Phase3：自定义数据地址（自由输入，不限类型）
    if (patch.customData !== undefined && patch.customData !== null) {
      const cd = patch.customData || {};
      if (!p.customData) p.customData = { items: [], genomes: [], annotations: [], other: [], note: '' };
      if (Array.isArray(cd.items)) p.customData.items = cd.items.map((it) => ({ path: String((it && it.path) || ''), desc: String((it && it.desc) || '') }));
      // 兼容旧字段
      if (Array.isArray(cd.genomes)) p.customData.genomes = cd.genomes.map(String);
      if (Array.isArray(cd.annotations)) p.customData.annotations = cd.annotations.map(String);
      if (Array.isArray(cd.other)) p.customData.other = cd.other.map(String);
      if (cd.note !== undefined) p.customData.note = String(cd.note);
    }
    // Phase3：分析计划/互动状态
    if (patch.plan !== undefined && patch.plan !== null) {
      const pl = patch.plan || {};
      if (!p.plan) p.plan = { content: '', planStatus: 'drafting', stepIds: [], updatedAt: 0 };
      if (pl.content !== undefined) p.plan.content = String(pl.content);
      if (pl.planStatus !== undefined) p.plan.planStatus = String(pl.planStatus);
      if (Array.isArray(pl.stepIds)) p.plan.stepIds = pl.stepIds.map(String);
      p.plan.updatedAt = Date.now();
    }
    // Phase3：里程碑质检（整体替换或按 name 更新）
    if (patch.milestones !== undefined && Array.isArray(patch.milestones)) {
      const byName = {};
      for (const m of p.milestones) byName[m.name] = m;
      p.milestones = patch.milestones.map((m) => {
        const name = String(m && m.name || '里程碑');
        const prev = byName[name] || {};
        return normMilestone({
          ...prev,
          ...m,
          name,
          updatedAt: (m && m.updatedAt) || Date.now(),
        });
      });
    }
    p.updatedAt = Date.now();
    saveAll(all);
    return { ok: true, project: p };
  });
}

/** 创建模块或更新模块元信息（name/desc/status）。 */
export async function upsertModule(projectId, input, sessionId) {
  return withProjectLock(() => {
    const all = loadAll();
    const idx = all.findIndex((p) => p.id === projectId && (!sessionId || p.sessionId === sessionId));
    if (idx < 0) return { ok: false, error: '项目不存在: ' + projectId };
    const project = all[idx];
    let mIdx;
    if (input.module_id) {
      mIdx = project.modules.findIndex((m) => m.id === String(input.module_id));
    } else {
      mIdx = -1;
    }
    const now = Date.now();
    let module;
    if (mIdx >= 0) {
      const prev = project.modules[mIdx];
      module = normModule({
        ...prev,
        name: input.name !== undefined ? String(input.name) : prev.name,
        desc: input.desc !== undefined ? String(input.desc) : prev.desc,
        status: input.status !== undefined && VALID_STATUS.includes(input.status) ? input.status : prev.status,
        updatedAt: now,
      });
      project.modules[mIdx] = module;
    } else {
      module = normModule({ id: input.module_id || undefined, name: input.name, desc: input.desc, status: input.status || 'pending', createdAt: now, updatedAt: now });
      project.modules.push(module);
    }
    project.updatedAt = now;
    saveAll(all);
    return { ok: true, module, project };
  });
}

function findModule(project, moduleId) {
  return project.modules.find((m) => m.id === moduleId) || null;
}

/** 开始一次新的模块运行（版本号自动递增：v1, v2, …），模块置为 running。 */
export async function startRun(projectId, moduleId, input, sessionId) {
  return withProjectLock(() => {
    const all = loadAll();
    const pIdx = all.findIndex((p) => p.id === projectId && (!sessionId || p.sessionId === sessionId));
    if (pIdx < 0) return { ok: false, error: '项目不存在: ' + projectId };
    const project = all[pIdx];
    const module = findModule(project, moduleId);
    if (!module) return { ok: false, error: '模块不存在: ' + moduleId };
    const now = Date.now();
    const version = module.runs.length + 1;
    const run = normRun({
      id: input.run_id || undefined,
      status: input.status || 'running',
      startedAt: now,
      dcsTaskIds: input.dcsTaskIds || input.dcs_task_ids || [],
      files: input.files || {},
      dcsCost: input.dcsCost || input.dcs_cost || null,
      dshTokens: input.dshTokens || input.dsh_tokens || null,
      notes: input.notes || '',
      progress: input.progress,
    }, String(version));
    module.runs.push(run);
    module.status = 'running';
    module.updatedAt = now;
    project.updatedAt = now;
    saveAll(all);
    return { ok: true, run, module, project };
  });
}

/** 更新一次运行的状态/文件清单/成本/token/备注。 */
export async function updateRun(projectId, moduleId, runId, patch, sessionId) {
  return withProjectLock(() => {
    const all = loadAll();
    const pIdx = all.findIndex((p) => p.id === projectId && (!sessionId || p.sessionId === sessionId));
    if (pIdx < 0) return { ok: false, error: '项目不存在: ' + projectId };
    const project = all[pIdx];
    const module = findModule(project, moduleId);
    if (!module) return { ok: false, error: '模块不存在: ' + moduleId };
    const run = module.runs.find((r) => r.id === runId);
    if (!run) return { ok: false, error: '运行不存在: ' + runId };
    if (patch.status !== undefined && VALID_STATUS.includes(patch.status)) {
      run.status = patch.status;
      if (patch.status === 'done' || patch.status === 'failed' || patch.status === 'blocked') run.finishedAt = patch.finishedAt || Date.now();
      if (patch.status === 'done') run.progress = 100;
    }
    if (patch.progress !== undefined && typeof patch.progress === 'number') run.progress = Math.max(0, Math.min(100, Math.floor(patch.progress)));
    if (patch.files !== undefined && patch.files !== null) run.files = normFiles(patch.files);
    if (patch.dcsTaskIds !== undefined) run.dcsTaskIds = Array.isArray(patch.dcsTaskIds) ? patch.dcsTaskIds.map(String) : run.dcsTaskIds;
    if (patch.dcsCost !== undefined && patch.dcsCost !== null) run.dcsCost = Number(patch.dcsCost);
    if (patch.dshTokens !== undefined && patch.dshTokens !== null) run.dshTokens = Number(patch.dshTokens);
    if (patch.notes !== undefined) run.notes = String(patch.notes);
    // 模块状态跟随运行状态（running 时置 running，其余在运行 done/failed 时同步）
    if (run.status === 'running') module.status = 'running';
    else if (module.status === 'running') module.status = run.status;
    module.updatedAt = Date.now();
    project.updatedAt = Date.now();
    saveAll(all);
    return { ok: true, run, module, project };
  });
}

/** 整体更新交付文档（关键节点梳理）：合并章节、递增 revision。 */
export async function updateDelivery(projectId, patch, sessionId) {
  return withProjectLock(() => {
    const all = loadAll();
    const pIdx = all.findIndex((p) => p.id === projectId && (!sessionId || p.sessionId === sessionId));
    if (pIdx < 0) return { ok: false, error: '项目不存在: ' + projectId };
    const project = all[pIdx];
    const current = normDelivery(project.delivery);
    const now = Date.now();
    const sections = { ...current.sections };
    if (patch.sections && typeof patch.sections === 'object') {
      for (const key of DELIVERY_SECTIONS) {
        if (patch.sections[key] !== undefined && patch.sections[key] !== null) sections[key] = String(patch.sections[key]);
      }
    }
    const delivery = {
      updatedAt: now,
      revision: (current.revision || 0) + 1,
      sections,
      charts: Array.isArray(patch.charts) ? patch.charts : current.charts,
    };
    project.delivery = delivery;
    project.updatedAt = now;
    saveAll(all);
    return { ok: true, delivery, project };
  });
}

/** 删除项目（含全部模块与交付）。 */
export async function deleteProject(projectId, sessionId) {
  return withProjectLock(() => {
    const all = loadAll();
    const next = all.filter((p) => !(p.id === projectId && (!sessionId || p.sessionId === sessionId)));
    if (next.length === all.length) return { ok: false, error: '项目不存在: ' + projectId };
    saveAll(next);
    return { ok: true };
  });
}
