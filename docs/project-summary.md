# 项目摘要

Anime Decrypto 是一个基于 React、Vite 和 Cloudflare 的网页多人截码战原型。前端负责展示和交互，房间状态、权限、实时同步和隐藏信息控制由 Cloudflare Worker / Durable Object 处理，D1 负责持久化。

## 当前技术栈

- 前端：React 19、TypeScript、Vite
- 部署：Cloudflare Pages
- API：Cloudflare Workers
- 房间状态机：Cloudflare Durable Objects
- 实时同步：Durable Object WebSocket
- 持久化：Cloudflare D1

## 核心文件

- [`src/App.tsx`](../src/App.tsx)：主 UI、房间流程、座位选择、阶段渲染、弱网同步兜底。
- [`src/lib/game.ts`](../src/lib/game.ts)：前端游戏客户端，封装 HTTP、WebSocket、WebSocket action 和 HTTP 回退。
- [`src/lib/session.ts`](../src/lib/session.ts)：Cloudflare 匿名会话 bootstrap。
- [`worker/index.ts`](../worker/index.ts)：Worker 路由、Durable Object 房间状态机、权限过滤、WebSocket action、D1 持久化。
- [`worker/data/bangumi-popular-anime.ts`](../worker/data/bangumi-popular-anime.ts)：Bangumi 热门动画离线榜单数据。
- [`d1/migrations/0001_initial.sql`](../d1/migrations/0001_initial.sql)：D1 房间表。
- [`d1/migrations/0002_bangumi_cache.sql`](../d1/migrations/0002_bangumi_cache.sql)：Bangumi 缓存表。
- [`wrangler.toml`](../wrangler.toml)：Worker、Durable Object、D1、环境变量配置。
- [`src/types.ts`](../src/types.ts)：前后端共享领域类型。
- [`src/lib/utils.ts`](../src/lib/utils.ts)：队伍、身份、阶段、猜测格式等工具函数。
- [`src/styles.css`](../src/styles.css)：UI 样式。

## 数据流

1. 前端调用 `ensureSession()`，使用本地匿名 session id 建立会话。
2. 创建房间、加入房间、加入状态查询等入口操作走 HTTP API。
3. Worker 将房间相关请求路由到对应 Durable Object。
4. 进入房间后，前端建立 `/api/rooms/:id/ws` WebSocket。
5. 房间内 action 优先通过 WebSocket message 发送。
6. Durable Object 串行执行 action，返回 `action_result` ack。
7. 状态变更后，Durable Object 广播按玩家身份过滤后的 snapshot。
8. Durable Object 将房间状态快照持久化到 D1。
9. WebSocket 不可用时，前端用同一个 `clientActionId` 回退到 HTTP `/action`。

## 隐藏信息

隐藏信息不靠 UI 判断：

- 队伍词语只返回给本队非观战玩家。
- 当前回合密码只返回给本轮对应加密/拦截者。
- 回合结果在结算前会过滤未公开字段。
- 房间操作在 Durable Object 内检查玩家身份和房主权限。

## 低 request 设计

当前版本的 request 控制重点：

- 正常房间 action 走 WebSocket，不走 HTTP POST。
- WebSocket action 使用 `clientActionId` ack，失败或超时才 HTTP 回退。
- Durable Object 广播 snapshot，前端不做固定轮询。
- snapshot GET 仅用于初始化、弱网兜底、前台恢复和完整历史。
- GET 请求不默认带 JSON content type 和自定义 session header，减少 CORS preflight。
- CORS 使用 `Access-Control-Max-Age` 缓存预检结果。
- 同一浏览器多标签页使用 BroadcastChannel leader，避免重复 WebSocket。

这套设计让稳定网络下的一局游戏主要消耗 WebSocket messages，而不是大量 Worker HTTP requests。

## 当前功能

- 创建/加入房间、自定义 6 位房间码。
- 4、6、8、10、12、14 人座位。
- 观战、中途加入、清空座位、房主转让、踢人、解散房间。
- 身份轮换、阶段倒计时、失误上限、生命模式。
- `lobby -> word_assignment -> encrypt -> decode -> intercept -> result -> finished` 主流程。
- 队伍词语确认、词语反馈、猜测反馈。
- Bangumi 用户/目录词库、热门榜单和角色提取。
- WebSocket 房间同步和 WebSocket action。
- D1 持久化房间状态。

## 迁移说明

旧版本使用 Supabase Auth、Postgres、RPC、RLS 和 Realtime。当前版本已经把这些职责迁移到 Cloudflare：

- Supabase Auth -> 本地匿名 session + Worker cookie/query session
- Supabase RPC -> Worker/Durable Object action
- Supabase Realtime -> Durable Object WebSocket
- Supabase RLS -> Worker/Durable Object 权限过滤
- Postgres 表 -> D1 `rooms` 表中的状态快照

当前部署只需要 Cloudflare 相关文件和配置。
