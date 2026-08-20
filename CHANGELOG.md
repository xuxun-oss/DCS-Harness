# Changelog

本项目的所有显著变更记录于此。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.1] - 2026-08-20

### 变更

- 找数据优先级调整：默认**优先查在线容器 `/public` 公共数据**（`dcs_container_ls`），`dcs_public_search` 降为容器外的元数据补充/跨片区检索；同步更新 systemPrompt、`dcs_atlas` 图谱 hints、工具描述与 README/docs。

## [0.5.0] - 2026-08-20

### 新增

- **浏览器「DCS Cloud」设置页**（`settings.section`）：无需在对话中操作即可填写/保存 PAT、一键登录、测试连接、查看当前登录态（用户名/片区/项目），并配置 `dcs` CLI 二进制路径与自动下载开关（`auto`/`never`）。
- **「DCS 任务」面板增强**：
  - 任务支持 `model`（Genpilot 模型下拉切换，自动持久化）与 `resources`（计算资源规格）；
  - 新增「离线任务与资源消耗」区块：展示最近 10 个 `dcs analysis` 任务的子任务状态、资源规格、费用与镜像（5 秒轮询）。
- `dcs_task_update` 工具新增 `model` / `resources` 参数。
- `lib/atlas.js` 新增 `GENPILOT_MODELS` 模型清单（auto / deepseek-v4-pro / deepseek-v4-flash / qwen3.7-max / glm-5.2 / kimi-k3 等）。

### 修复

- 依赖修正：`@deepseek-ai/dsh-tools` 从 `peerDependencies` 移入 `dependencies`（`0.1.0-rc.7`），干净安装不再报 `ERR_MODULE_NOT_FOUND`。
- 配置文件 `~/.dsh/dcs-cloud.json` 写入时收紧为 `0600` 权限（可能含 PAT）。

## [0.4.2] - 2026-08-20

### 修复

- 「DCS 任务」tab 按会话隔离任务。

## [0.4.1] - 2026-08-20

### 新增

- 「DCS 任务」面板步骤可点击展开，展示交付物（数据集 + 结果/图表/报告/文件）。

## [0.4.0] - 2026-08-20

### 新增

- 浏览器「DCS 任务」tab（`conversation.view`）：分析计划、数据源、步骤依赖关系、执行进展可视化。
- 任务追踪工具：`dcs_task_update` / `dcs_step_status`。

## [0.3.0] - 2026-08-19

### 新增

- 结合 E16.5 MOSTA 实测经验加速分析（公共库检索、容器公共数据集路径、h5ad 结构探查等）。

## [0.2.1] - 2026-08-19

### 修复

- Genpilot LLM 与 Genos 为 DCS 系统自带，移除手动 API key 配置。

## [0.2.0] - 2026-08-19

### 新增

- 数据库全图谱 + Genpilot 能力：`dcs_atlas` / `dcs_llm` / `dcs_parallel_run` / `dcs_plan`。

## [0.1.0] - 2026-08-19

### 新增

- 首个版本：`dsh-dcs-cloud` 插件 —— 接入 BGI Research 的 `dcs` CLI，面向 DCS Cloud 的生信研究编排。
