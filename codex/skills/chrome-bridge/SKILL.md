---
name: "chrome-bridge"
description: "连接本机已登录的 Google Chrome，读取和操作标签页、页面内容、浏览器数据及页面调试信息。"
---

# Chrome Bridge

通过 Chrome MCP Bridge 连接本机正在运行的 Google Chrome。连接链路为：

```text
Codex Skill / CLI / MCP
  -> per-user Unix Socket reported by the Native Messaging Host
  -> Chrome Native Messaging Host
  -> Chrome Extension
  -> Google Chrome
```

## 连接方法

设置项目目录：

```bash
export CHROME_BRIDGE_ROOT="/absolute/path/to/codex-chrome-bridge"
```

首次使用时，先加载 Chrome 扩展并安装 Native Messaging Host：

```text
Chrome -> chrome://extensions/ -> Load unpacked -> $CHROME_BRIDGE_ROOT/extension
```

```bash
npm --prefix "$CHROME_BRIDGE_ROOT" run install:native-host -- <extension-id>
```

CLI 连接：

```bash
node "$CHROME_BRIDGE_ROOT/bin/chrome-bridge.mjs" health
node "$CHROME_BRIDGE_ROOT/bin/chrome-bridge.mjs" tabs
```

MCP 连接：

```bash
node "$CHROME_BRIDGE_ROOT/mcp/chrome-bridge-mcp.mjs"
```

MCP 客户端配置使用 stdio：

```json
{
  "mcpServers": {
    "chrome-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/codex-chrome-bridge/mcp/chrome-bridge-mcp.mjs"]
    }
  }
}
```

默认连接不需要启动 HTTP、WebSocket 或 LaunchAgent 服务。CLI 和 MCP 会通过 Unix Socket 连接由 Chrome Native Messaging Host 提供的桥接通道。

## 支持功能

- 标签页和窗口：列出、打开、激活、关闭、刷新、前进、后退、等待加载。
- 工作区和标签组：查看工作区、设置工作区、管理 Codex Bridge 标签组、接管已打开标签页。
- 页面读取：读取可见文本、HTML、快照、诊断信息、元素、链接、表格、选择项和页面存储。
- 页面交互：点击、坐标点击、悬停、输入文字、键盘操作、滚动、选择选项、填写表单、拖放、处理对话框、上传文件。
- 页面导航：打开 HTTP/HTTPS 页面、管理临时标签页、等待选择器和页面状态。
- 页面产物：截取视口或完整页面截图，导出 PDF，保存本地页面产物。
- 浏览器数据：搜索历史、书签、Cookies，并从扩展上下文发起页面请求。
- 调试能力：读取控制台和网络追踪、查看性能诊断、执行 Lighthouse 计划、设置视口和网络模拟。
- 信息提取：文章、产品页、价格表、CPA Offer、下载链接和结构化页面数据提取。
- 人机协作：打开本地提问页面，收集用户输入、选项和确认结果。
- MCP 工具：通过 `chrome_bridge_*` 工具访问上述标签页、页面、浏览器数据、调试、提取和协作功能。

## 常用命令

```bash
node "$CHROME_BRIDGE_ROOT/bin/chrome-bridge.mjs" windows
node "$CHROME_BRIDGE_ROOT/bin/chrome-bridge.mjs" open "https://example.com"
node "$CHROME_BRIDGE_ROOT/bin/chrome-bridge.mjs" snapshot --max-chars 60000
node "$CHROME_BRIDGE_ROOT/bin/chrome-bridge.mjs" text --max-chars 60000
node "$CHROME_BRIDGE_ROOT/bin/chrome-bridge.mjs" screenshot --out /tmp/chrome-bridge.png
node "$CHROME_BRIDGE_ROOT/bin/chrome-bridge.mjs" diagnostics --out /tmp/chrome-bridge-diagnostics.json
```

## 验证与恢复

先运行 `runtime-smoke --coverage-plan`，再进行在线验证。发布前至少执行 `npm run check:mcp-runtime-smoke`、`npm run check:tab-group-persistence` 和 `npm run check:privacy`。

升级扩展后，按顺序执行 `reload-extension --confirm`、`doctor --live-checks`，再运行在线 runtime smoke。成功条件是 `verification.status: "passed"`。失败时读取 `verification.nextCommand`、`verification.nextAction`，同时查看 top-level `nextCommand` / `nextAction`。

`check:roadmap` 的延迟在线闸门通过 `deferredLiveVerification` 表示；最终完成标记是 `finalVerificationComplete`。
