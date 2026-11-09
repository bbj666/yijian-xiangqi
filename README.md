# 弈鉴 · 象棋训练室

弈鉴是一款在浏览器本地运行的中国象棋打谱与人机训练网站。规则、棋局和皮卡鱼分析均在浏览器中完成，棋谱不会上传到服务器。

## 功能

- 打谱复盘：导入天天象棋导出的中文棋谱或 UCCI 着法，逐步训练；偏离原谱时显示谱招、引擎分差和局面解释，可一键回到谱线。
- 人机对弈：与 Pikafish 对弈；用户走出可疑、错误或严重失误时，显示后续风险、推荐招与主变。
- 完整象棋规则：合法走子、将军、将死、困毙、重复局面及中文记谱。
- 本地 AI：Pikafish WebAssembly + 12.6 MB NNUE，首次加载后可使用浏览器缓存。
- 响应式棋盘：支持桌面和手机、翻转棋盘、悔棋、提示与棋谱导出。

## 天天象棋边界

天天象棋没有面向第三方网页公开、稳定且授权清晰的 AI 接口。本项目不抓取账号数据、不绕过登录，也不调用私有接口。用户可从天天象棋复制或导出棋谱，再粘贴到“导入天天象棋棋谱”中训练。分析与对弈由开源 Pikafish 完成。

## 本地运行

需要 Node.js 20+ 和 pnpm。

```bash
pnpm install
pnpm dev
```

开发地址为 `http://localhost:5173`。生产构建：

```bash
pnpm build
pnpm start
```

生产地址默认为 `http://localhost:4173`。服务端必须返回以下响应头，否则多线程 WebAssembly 无法启动：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

## Render 部署

仓库根目录已包含 `render.yaml`：

1. 将仓库推送到 GitHub。
2. 在 Render 选择 **New > Blueprint**。
3. 连接该仓库并应用 Blueprint。

Render 会安装依赖并执行生产构建，再由 `server.mjs` 提供静态文件和 WebAssembly 所需的隔离响应头。

## 技术与许可

- React、TypeScript、Vite
- `@pikafish-js/rules`
- `pikafish-js` WebAssembly Worker
- Pikafish NNUE w256

项目采用 AGPL-3.0-or-later。Pikafish 上游采用 GPL-3.0；`pikafish-js` 与规则包采用 AGPL-3.0-or-later。部署公开版本时，应同时公开本项目对应版本的完整源码。
