// dsh-dcs-cloud — DCS 任务状态存储（Host 侧，纯 Node）。
// 维护「DCS 任务」面板所需的分析计划/数据源/步骤逻辑关系/进展，持久化于 ~/.dsh/dcs-cloud-tasks.json。
// 由 dcs_task_update 工具写入，/api/dcs-cloud/tasks 路由读取，浏览器「DCS 任务」tab 渲染。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const VALID_STATUS = ['pending', 'running', 'done', 'failed', 'blocked'];

export function tasksPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dcs-cloud-tasks.json');
}

export function loadTasks() {
  try {
    const d = JSON.parse(readFileSync(tasksPath(), 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks) {
  mkdirSync(dirname(tasksPath()), { recursive: true });
  writeFileSync(tasksPath(), JSON.stringify(tasks, null, 2));
}

function normStep(s) {
  const step = {
    id: String(s.id || 'step-' + Math.random().toString(36).slice(2, 7)),
    title: String(s.title || s.desc || ''),
    status: VALID_STATUS.includes(s.status) ? s.status : 'pending',
    detail: String(s.detail || s.desc || ''),
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : (Array.isArray(s.deps) ? s.deps.map(String) : []),
    outputs: Array.isArray(s.outputs) ? s.outputs.map(String) : [],
    progress: typeof s.progress === 'number' ? Math.max(0, Math.min(100, Math.floor(s.progress))) : (s.status === 'done' ? 100 : 0),
  };
  return step;
}

function normSource(s) {
  return {
    name: String(s.name || ''),
    path: String(s.path || ''),
    type: String(s.type || ''),
    desc: String(s.desc || ''),
  };
}

/** 创建或更新一个任务，返回最新任务列表。 */
export function upsertTask(input) {
  const tasks = loadTasks();
  const now = Date.now();
  const id = input.task_id ? String(input.task_id) : ('dcs-task-' + now + '-' + Math.random().toString(36).slice(2, 6));
  const steps = (input.steps || []).map(normStep);
  const dataSources = (input.dataSources || input.data_sources || []).map(normSource);
  const task = {
    id,
    title: String(input.title || '未命名 DCS 任务'),
    objective: String(input.objective || ''),
    dataSources,
    steps,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx >= 0) {
    task.createdAt = tasks[idx].createdAt || now;
    tasks[idx] = task;
  } else {
    tasks.unshift(task);
  }
  // 修剪到最近 50 个任务
  const trimmed = tasks.slice(0, 50);
  saveTasks(trimmed);
  return { task, tasks: trimmed };
}

/** 单步状态更新（轻量，供 agent 逐步推进时调用）。 */
export function updateStepStatus(taskId, stepId, status, detail, progress) {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, error: '任务不存在: ' + taskId };
  const step = task.steps.find((s) => s.id === stepId);
  if (!step) return { ok: false, error: '步骤不存在: ' + stepId };
  if (status) step.status = VALID_STATUS.includes(status) ? status : step.status;
  if (detail !== undefined && detail !== null && detail !== '') step.detail = String(detail);
  if (typeof progress === 'number') step.progress = Math.max(0, Math.min(100, Math.floor(progress)));
  if (step.status === 'done') step.progress = 100;
  task.updatedAt = Date.now();
  saveTasks(tasks);
  return { ok: true, task };
}

export function getTask(taskId) {
  const tasks = loadTasks();
  return tasks.find((t) => t.id === taskId) || null;
}
