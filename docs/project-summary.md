# 项目摘要

Anime Decrypto 是一个基于 React、Vite 和 Cloudflare 的网页多人截码战原型。前端只负责展示和调用接口，房间状态、权限、实时同步和隐藏信息控制放在 Cloudflare Worker / Durable Object 里处理，D1 负责持久化。

## 当前技术栈

- 前端：React 19、TypeScript、Vite
- 部署：Cloudflare Pages
- API：Cloudflare Workers
- 实时：Durable Objects + WebSocket
- 持久化：Cloudflare D1

## 核心文件

- [`src/App.tsx`](../src/App.tsx)：主 UI、房间流程、座位选择、阶段渲染。
- [`src/lib/game.ts`](../src/lib/game.ts)：前端游戏 API 客户端，封装 HTTP 和 WebSocket。
- [`src/lib/session.ts`](../src/lib/session.ts)：Cloudflare 匿名会话 bootstrap。
- [`worker/index.ts`](../worker/index.ts)：Worker 路由、Durable Object 房间状态机、权限过滤、D1 持久化。
- [`worker/data/bangumi-popular-anime.ts`](../worker/data/bangumi-popular-anime.ts)：Bangumi 热门动画离线榜单数据。
- [`d1/migrations/0001_initial.sql`](../d1/migrations/0001_initial.sql)：D1 表结构。
- [`wrangler.toml`](../wrangler.toml)：Worker、Durable Object、D1 绑定配置。
- [`src/types.ts`](../src/types.ts)：前后端共享领域类型。
- [`src/lib/utils.ts`](../src/lib/utils.ts)：队伍、身份、阶段、猜测格式等工具函数。
- [`src/styles.css`](../src/styles.css)：UI 样式。

## 数据流

1. 前端调用 `src/lib/session.ts` 的 `ensureSession()`。
2. Worker 通过本地匿名 session id 建立玩家会话。
3. 前端通过 `src/lib/game.ts` 调用 `/api/*`。
4. Worker 把房间请求路由到对应 Durable Object。
5. Durable Object 串行处理房间操作并广播 WebSocket 变更。
6. Durable Object 将完整房间状态快照写入 D1。
7. 前端收到 WebSocket 变更后刷新房间快照。

## 隐藏信息

隐藏信息不靠 UI 判断：

- 队伍词语只返回给本队非观战玩家。
- 当前回合密码只返回给本轮对应加密/拦截者。
- 回合结果在结算前会过滤未公开字段。
- 房间操作在 Durable Object 内检查玩家身份和房主权限。

## 当前功能

- 创建/加入房间、自定义 6 位房间码。
- 4、6、8、10、12、14 人座位。
- 观战、中途加入、清空座位、房主转让、踢人、解散房间。
- 身份轮换、阶段倒计时、失误上限、生命模式。
- `lobby -> word_assignment -> encrypt -> decode -> intercept -> result -> finished` 主流程。
- 队伍词语确认、词语反馈、猜测反馈。
- Bangumi 用户/目录词库、热门榜单和角色提取。
- WebSocket 房间同步。
- D1 持久化房间状态。

## 迁移说明

旧版本使用 Supabase Auth、Postgres、RPC、RLS 和 Realtime。当前版本已经把这些职责迁移到 Cloudflare：

- Supabase RPC -> Worker/Durable Object action
- Supabase Realtime -> Durable Object WebSocket
- Supabase RLS -> Worker/Durable Object 权限过滤
- Postgres 表 -> D1 `rooms` 表中的状态快照

旧版 Supabase 目录已删除；当前部署只需要 Cloudflare 相关文件。
