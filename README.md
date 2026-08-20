# dsh-dcs-cloud

DeepSeek Harness 插件：接入 BGI Research 发布的 [**dcs CLI**](https://github.com/BGIResearch/dcs_cli)，面向 **DCS Cloud**（[cloud.stomics.tech](https://cloud.stomics.tech)）做基因组 / 时空组学的**生信研究编排**。

在 DSH 里完成「任务分解 → 深度研究 → 形成研究方案 → 数据检索 → Genpilot 流程复用 → 脚本审计 → 在线/离线执行 → 学术网页报告」的完整闭环。

## 能力一览

| 工具 | 作用 |
| --- | --- |
| `dcs_atlas` | 查看「数据库全图谱」：11 片区公共库 + 官方组学工具库（8 大类）+ 关键词映射 + 容器公共数据集 |
| `dcs_public_search` | 直接搜索 DCS 公共库（公共数据/流程/项目/AI模型，走 REST API，最快找公共数据） |
| `dcs_container_ls` | 列在线容器目录（`/public` 公共库挂载、`/work` 已有分析） |
| `dcs_data_inspect` | 快速查看 h5ad/csv 结构（细胞类型 annotation / 脑区 / 基因，不加载矩阵） |
| `dcs_find_results` | 查找 /work 里 Genpilot 已跑的分析结果，避免重复计算 |
| `dcs_login` / `dcs_status` / `dcs_configure` | PAT 登录、查看当前项目/片区、本地配置 |
| `dcs_data_ls` / `dcs_data_find` / `dcs_data_info` | 在 DCS 数据管理（`/Files` 文件结构）检索数据（**第一优先级**：平台公共库） |
| `dcs_data_download` | 下载数据到本机（**第二优先级**：外部数据获取） |
| `dcs_workflow_search` / `dcs_workflow_info` | 检索并查看 Genpilot 现有流程（WDL）与参数规格、多步规划（**第一优先级**：复用现有脚本/方案） |
| `dcs_terminal_exec` / `dcs_terminal_file` | 在线容器（Genpilot 智能分析环境）执行 / 读写文件（**第二优先级**：在线写新脚本、简单任务在线运行） |
| `dcs_offline_run` / `dcs_parallel_run` | 离线任务投递（长任务/资源大/需并行）；`dcs_parallel_run` 按 `{i}` 分片并行投递 |
| `dcs_workflow_run` | 投递 WDL 工作流任务 |
| `dcs_task_status` | 跟踪离线任务与 WDL 任务状态 / 日志 |
| `dcs_task_update` / `dcs_step_status` | 把「分析计划 + 数据源 + 步骤依赖关系 + 进展」写入「DCS 任务」面板（浏览器 tab） |
| `dcs_llm` | 调用 DCS 托管 Genpilot LLM（deepseek-v4-pro）做解读 / 文献综合 / 写作 |
| `dcs_plan` | 生成 Genpilot 风格 Plan.md（步骤进度表 + 产物路径 + 方法学 + 总结） |
| `dcs_audit_script` | 执行前静态审计脚本（危险命令 / 硬编码密钥 / 注入 / 资源镜像配置） |
| `dcs_generate_report` | 把结果、图表、方法按学术逻辑整理成自包含 HTML 网页 |
| `dcs_cli` | 通用透传任意 `dcs` 命令（逃生舱） |

## 「DCS 任务」面板（浏览器 UI）

插件在 DSH web 的对话视图里增加一个 **「DCS 任务」tab**（`conversation.view`），除了对话外，可视化展示：

- **分析计划**：任务标题、研究目标、步骤清单；
- **模型 / 资源**：当前任务使用的 Genpilot 模型（下拉切换，自动持久化）与计算资源规格；
- **数据源**：每步用到的数据（名称 / 路径 / 类型）；
- **步骤逻辑关系**：步骤间的依赖（`依赖 → step1 → step2`）；
- **分析细节**：每步的说明与输出、交付物（数据集 / 结果 / 图表 / 报告 / 文件）；
- **执行进展**：每步状态（待执行/进行中/已完成/失败/受阻）+ 进度条，5 秒自动刷新；
- **离线任务与资源消耗**：最近 10 个离线任务（`dcs analysis`）的子任务状态、资源规格、费用与镜像，5 秒自动刷新。

数据由 agent 通过 `dcs_task_update`（建任务/写步骤，可带 `model`/`resources`）和 `dcs_step_status`（单步推进）写入，存于 `~/.dsh/dcs-cloud-tasks.json`；离线任务清单实时读 `dcs analysis ls/info`。

## 「DCS Cloud」设置页（浏览器 UI）

插件还在 DSH 设置（`settings.section`，导航栏「DCS Cloud」）里提供一个配置页，**无需在对话中操作**即可完成：

- 填写/保存 **PAT**（`dcs_pat_...`）并一键登录、测试连接；
- 展示当前登录态（用户名 / 片区 / 项目）；
- 配置 `dcs` CLI 二进制路径与自动下载开关（`auto` / `never`）。

配置写入 `~/.dsh/dcs-cloud.json`，与 `dcs_login` / `dcs_configure` 工具共用同一份配置。

插件通过 systemPrompt 注入上面的流程引导，让 agent 自动按「公共库优先、现有脚本优先、审计后执行、离线并行、网页交付」的规则推进。

详细图谱见 [`docs/dcs-database-atlas.md`](docs/dcs-database-atlas.md)（片区公共库、官方组学工具库、Genpilot 使用范式）。

## 前置：dcs CLI 与 PAT

`dcs` 是 BGI Research 发布的**本机二进制**（Go），通过 **Personal Access Token (PAT)** 登录 DCS Cloud。

1. 获取 PAT：登录 DCS Cloud →「个人中心 → API Key / PAT 管理」创建，形如 `dcs_pat_xxx`。
2. 插件首次调用时会自动按当前平台下载对应二进制（含 SHA256 校验）到 `~/.dsh/dcs-bin/`；也可手动安装：

```bash
# macOS（Apple Silicon）
curl -L -o dcs https://github.com/BGIResearch/dcs_cli/releases/download/v1.1.0/dcs-darwin-arm64
chmod +x dcs && sudo mv dcs /usr/local/bin/dcs
```

## 安装

```bash
# 从 GitHub 安装（推荐）
dsh plugin --profile web add github:xuxun-oss/DCS-Harness

# 或本地目录安装
dsh plugin --profile web add /path/to/DCS-Harness

# 然后重启 dsh web（或按 dsh 的插件热载提示操作）
```

在会话中对 agent 说「用 DCS 云分析 XX 数据」，或直接调用 `dcs_login` 输入 PAT 开始。

## 安全说明

- PAT 仅运行时使用：交给 `dcs` 自身**加密存储**在 `~/.dcs/config.yaml`；同时为直连公共库检索 API 而缓存于 `~/.dsh/dcs-cloud.json`（本机私有文件，写入时设为 `0600` 权限，不通过任何接口外发）。
- 插件本地配置（二进制路径、自动下载开关）存于 `~/.dsh/dcs-cloud.json`。
- **Genpilot LLM 与 Genos 模型为 DCS 系统自带**：自动鉴权、模型自动选择，无需额外填写 API key；唯一需要的是 `dcs_pat_...`（仅用于 dcs CLI 登录）。
- `dcs_data_rm`、`dcs_task_cancel/rm` 等破坏性命令**不会**由高层工具直接触发；如需使用请走 `dcs_cli` 透传，并确认后果。
- 执行前请用 `dcs_audit_script` 审计脚本。

## 目录

```
lib/index.js         宿主半：27 个工具 + systemPrompt 流程引导 + 「DCS 任务/设置」HTTP 路由
lib/dcs-client.js    dcs 二进制管理、PAT 登录、命令执行、公共库检索
lib/atlas.js         数据库全图谱（片区/官方工具库/关键词映射/容器公共数据集/Genpilot 范式/模型列表）
lib/audit.js         脚本静态审计（shell/python/WDL 分级报告）
lib/plan.js          Plan.md 生成（Genpilot 执行计划文档）
lib/report.js        学术 HTML 报告生成（图片 base64 内嵌）
lib/tasks.js         任务存储（按会话作用域）+ 局部字段更新（model/resources）
lib/client.js        浏览器半：「DCS 任务」tab + 「DCS Cloud」设置页（settings.section）
docs/dcs-cli-reference.md     dcs CLI 完整能力图谱（命令/参数/JSON 输出）
docs/dcs-database-atlas.md    数据库全图谱（片区公共库/官方工具库/Genpilot 范式）
cordis.patch.yml     组合 patch（insert 行）
package.json         包元数据（dsh.bundle）
```
