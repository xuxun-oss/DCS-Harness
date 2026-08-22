#!/usr/bin/env bash
# DCS Harness v2.5 — 安装到默认 dsh（web profile），窗口自动可用，无需独立页面。
#
# 用法：
#   bash scripts/install-harness-profile.sh                 # 用本仓库路径安装（本地开发）
#
# 安装后：
#   重启 dsh web（或 dsh 的插件热载提示操作）→ 对话上方自动出现
#   「项目管理 / 结果交付」两个窗口 +「DCS Cloud」设置页，
#   无需独立 profile / 启动器按钮。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 安装 dsh-dcs-cloud 到默认 dsh（web profile）"
dsh plugin --profile web add "$REPO_DIR"

echo ""
echo "✅ DCS Harness 已安装到默认 dsh（web profile）。"
echo "   重启 dsh web 后，「项目管理 / 结果交付」两个窗口自动出现在对话上方，"
echo "   设置 → DCS Cloud 配置 PAT 即可开始使用；无需再启动独立页面。"
