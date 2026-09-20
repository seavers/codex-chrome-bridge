#!/usr/bin/env bash
set -Eeuo pipefail

# 统一处理扩展、Native Host、桥接检查和 MCP 信息展示，避免重复手工执行部署步骤。
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${NODE_BIN:-node}"
CHROME_APP="${CHROME_APP:-Google Chrome}"
CLI=("${NODE_BIN}" "${ROOT_DIR}/bin/chrome-bridge.mjs")

usage() {
  cat <<'EOF'
用法: ./deploy.sh <子命令> [参数]

子命令:
  help                         显示帮助
  paths                        显示部署路径和当前版本
  open-extension               打开 Chrome 扩展管理页，加载或刷新 unpacked extension
  install-host <extension-id>  安装 Native Messaging Host manifest
  reload                       通过已连接的 Chrome 扩展执行 reloadExtension
  health                       查看 Native Host、Unix Socket 和扩展连接状态
  mcp-info [profile]           展示 MCP server、工具数量、profile 和配置入口
  check                        执行部署前的最小本地检查
  deploy <extension-id>       安装 Host、打开扩展页、刷新扩展并验证健康状态

环境变量:
  CHROME_BRIDGE_EXTENSION_ID  可替代 install-host/deploy 的 extension-id 参数
  CHROME_BRIDGE_MCP_TOOL_PROFILE  mcp-info 默认使用的 MCP profile
  CHROME_APP                  macOS Chrome 应用名，默认 Google Chrome
EOF
}

die() {
  echo "deploy.sh: $*" >&2
  exit 1
}

run_cli() {
  (cd "${ROOT_DIR}" && "${CLI[@]}" "$@")
}

extension_id_from_args() {
  local extension_id="${1:-${CHROME_BRIDGE_EXTENSION_ID:-}}"
  [[ -n "${extension_id}" ]] || die "需要 unpacked extension id，例如: ./deploy.sh install-host abcdefghijklmnop"
  printf '%s\n' "${extension_id}"
}

open_extension_page() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    open -a "${CHROME_APP}" 'chrome://extensions/'
  elif command -v google-chrome >/dev/null 2>&1; then
    google-chrome 'chrome://extensions/' >/dev/null 2>&1 &
  elif command -v chromium >/dev/null 2>&1; then
    chromium 'chrome://extensions/' >/dev/null 2>&1 &
  else
    die '找不到 Chrome 可执行文件，请手动打开 chrome://extensions/'
  fi
  echo "已打开 chrome://extensions/，扩展目录: ${ROOT_DIR}/extension"
}

show_paths() {
  (cd "${ROOT_DIR}" && "${NODE_BIN}" - "${ROOT_DIR}" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_VERSION, MCP_TOOLS } from './shared/registry/index.mjs';

const root = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
console.log(JSON.stringify({
  version: BRIDGE_VERSION,
  extensionVersion: manifest.version,
  extensionPath: path.join(root, 'extension'),
  nativeHost: path.join(root, 'native/host.mjs'),
  mcpServer: path.join(root, 'mcp/chrome-bridge-mcp.mjs'),
  mcpTools: MCP_TOOLS.length,
}, null, 2));
NODE
  )
}

show_mcp_info() {
  local profile="${1:-${CHROME_BRIDGE_MCP_TOOL_PROFILE:-full}}"
  (cd "${ROOT_DIR}" && CHROME_BRIDGE_MCP_TOOL_PROFILE="${profile}" "${NODE_BIN}" - "${ROOT_DIR}" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_VERSION, MCP_TOOLS } from './shared/registry/index.mjs';

const root = process.argv[2];
const profile = process.env.CHROME_BRIDGE_MCP_TOOL_PROFILE || 'full';
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const config = {
  mcpServers: {
    'chrome-bridge': {
      command: process.execPath,
      args: [path.join(root, 'mcp/chrome-bridge-mcp.mjs')],
      env: { CHROME_BRIDGE_MCP_TOOL_PROFILE: profile },
    },
  },
};
console.log(JSON.stringify({
  version: BRIDGE_VERSION,
  extensionVersion: manifest.version,
  profile,
  toolCount: MCP_TOOLS.length,
  tools: MCP_TOOLS,
  server: config.mcpServers['chrome-bridge'],
  config,
}, null, 2));
NODE
  )
}

check() {
  (cd "${ROOT_DIR}" && npm run check:registry && npm run check:extension-package && npm run check:pack)
}

deploy() {
  local extension_id
  extension_id="$(extension_id_from_args "${1:-}")"
  check
  (cd "${ROOT_DIR}" && npm run install:native-host -- "${extension_id}")
  open_extension_page
  echo '请在 chrome://extensions/ 点击扩展的“重新加载”；如果扩展尚未加载，请选择“加载已解压的扩展程序”并选择上面的 extension 目录。'
  run_cli reload-extension --confirm
  run_cli health
}

command="${1:-help}"
shift || true
case "${command}" in
  help|-h|--help) usage ;;
  paths) show_paths ;;
  open-extension) open_extension_page ;;
  install-host)
    extension_id="$(extension_id_from_args "${1:-}")"
    (cd "${ROOT_DIR}" && npm run install:native-host -- "${extension_id}")
    ;;
  reload) run_cli reload-extension --confirm ;;
  health) run_cli health ;;
  mcp-info) show_mcp_info "${1:-}" ;;
  check) check ;;
  deploy) deploy "${1:-}" ;;
  *) die "未知子命令: ${command}，运行 ./deploy.sh help 查看帮助" ;;
esac
