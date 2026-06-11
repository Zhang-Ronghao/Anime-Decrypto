
# Anime Decrypto

Anime Decrypto 是一个基于 React 和 Cloudflare 的网页多人「动漫高手——截码战」

[游戏链接](https://anime-decrypto.pages.dev/)
[备用连接](https://anime-decrypto.netlify.app/)

和群 u 的动漫高手不知不觉也开到 4.0 了，靠 AI 水了个动漫高手版截码战。

持续搜集游戏 idea 中，有好玩的方法欢迎提出！

附上之前的[动漫高手 3.0：一眼顶针（方块猜图）](https://github.com/Davy-Chendy/anime-master-game)，新版本即将到来，敬请期待！


**以下内容均为AI生成**

当前架构：

- 前端：React 19 + TypeScript + Vite
- 前端托管：Cloudflare Pages
- API 与实时通道：Cloudflare Workers + Durable Objects
- 房间状态机：每个房间一个 Durable Object
- 持久化：Cloudflare D1
- 实时同步：Durable Object WebSocket

旧版 Supabase Auth / RPC / RLS / Realtime 已迁移到 Cloudflare Worker 和 Durable Object。

## 文档入口

- [游戏教程/规则](./docs/game-rules.md)
- [架构说明](./docs/architecture.md)
- [部署说明](./docs/deployment.md)
- [Bangumi 词库说明](./docs/bangumi-catalog.md)
- [项目摘要](./docs/project-summary.md)

## 功能亮点

- 创建/加入房间、自定义 6 位房间码。
- 支持 4、6、8、10、12、14 人座位。
- 支持观战、中途加入、清空座位、房主转让、踢人、解散房间。
- 支持身份轮换、阶段倒计时、失误上限、生命模式、重新开始和终止游戏。
- 支持 Bangumi 用户/目录词库、热门榜单、角色提取、词语反馈、猜测反馈和回合记录。
- 隐藏信息由 Worker/Durable Object 根据玩家身份过滤，不依赖前端隐藏。
- 房间内操作优先走 WebSocket action，HTTP 只作为创建/加入/查询/兜底通道，以降低 Cloudflare Worker request 数量。

## 快速本地启动

安装依赖：

```bash
npm install
```

创建 `.env.local`：

```bash
VITE_API_BASE_URL=http://localhost:8787
```

初始化本地 D1：

```bash
npm run d1:migrate:local
```

启动 Worker：

```bash
npm run worker:dev
```

另开一个终端启动前端：

```bash
npm run dev
```

## 快速部署

1. `npx wrangler login`
2. `npx wrangler d1 create anime_decrypto`
3. 把输出的 `database_id` 填进 `wrangler.toml`
4. `npm run d1:migrate:remote`
5. `npm run worker:deploy`
6. 在 Cloudflare Pages 导入仓库：
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `VITE_API_BASE_URL=<你的 Worker 地址>`
7. 把 `wrangler.toml` 里的 `ALLOWED_ORIGIN` 改成 Pages 地址，再重新 `npm run worker:deploy`

详细步骤见 [部署说明](./docs/deployment.md)。

## 低 request 设计

Cloudflare Workers 免费额度按 Worker 入站 request 统计。项目当前尽量让正常一局游戏不依赖高频 HTTP：

- 创建房间、加入房间、会话初始化仍走 HTTP。
- 进入房间后，选座、开始游戏、提交线索、猜密码、推进回合等 action 优先走 WebSocket message。
- WebSocket action 有 `clientActionId` ack；连接不可用或超时才回退到原来的 HTTP `/action`。
- Durable Object 处理 action 后直接通过 WebSocket 广播按玩家过滤后的 snapshot，前端正常情况下不轮询。
- snapshot GET 只用于初始化、弱网兜底、前台恢复、完整历史等少数场景。
- GET 请求不默认带 `content-type: application/json` 和自定义 session header，减少 CORS preflight。
- Worker CORS 响应设置 `Access-Control-Max-Age`，降低重复 OPTIONS。
- 同一浏览器多标签页通过 BroadcastChannel 选出一个实时连接 leader，避免同一房间重复开多个 WebSocket。

部署后可以用开发环境右下角 debug 面板观察：

- `ws-action` 应随游戏操作增长。
- `action` 只应在 WebSocket 不可用时增长。
- `snapshot` 和 `fallback` 不应持续快速增长。

## 验证命令

```bash
npm run worker:typecheck
npm run build
npx wrangler deploy --dry-run
```

## 当前边界

- 这是可玩的 Web 原型，不是完整商业化产品。
- 断线重连和房间清理是基础实现。
- 倒计时主要用于 UI 提示和状态记录，不会自动强制提交或跳阶段。
- Bangumi 用户/目录抓取和热门榜单入口在 Worker 内实现，外部 API 仍可能受 Bangumi 服务可用性影响。
