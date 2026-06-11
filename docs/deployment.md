# Cloudflare 部署说明

本项目当前使用：

- 前端：Cloudflare Pages，部署 Vite/React 的 `dist/`
- 后端：Cloudflare Workers，提供 `/api/*`
- 实时房间：Durable Objects，每个房间一个有状态对象
- 持久化：D1，保存房间状态快照和 Bangumi 缓存

不再需要 Supabase URL、Supabase anon key、Supabase RPC、RLS 或 Realtime。

## 1. 本地开发

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

开两个终端。

第一个终端启动 Worker：

```bash
npm run worker:dev
```

第二个终端启动前端：

```bash
npm run dev
```

打开 Vite 给出的地址，通常是：

```text
http://localhost:5173
```

## 2. 创建 Cloudflare D1

登录 Cloudflare：

```bash
npx wrangler login
```

创建远程 D1 数据库：

```bash
npx wrangler d1 create anime_decrypto
```

命令输出里会有类似配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "anime_decrypto"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把 `database_id` 复制到项目根目录的 `wrangler.toml`：

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

执行远程 D1 迁移：

```bash
npm run d1:migrate:remote
```

## 3. 部署 Worker 后端

先检查 Worker 能否打包：

```bash
npx wrangler deploy --dry-run
```

正式部署：

```bash
npm run worker:deploy
```

部署成功后，终端会显示 Worker 地址，例如：

```text
https://anime-decrypto-api.<your-name>.workers.dev
```

## 4. 配置 Worker CORS

线上 Pages 和 Worker 通常不是同一个 origin，因此 Worker 需要允许 Pages origin。

在 `wrangler.toml` 中设置：

```toml
[vars]
ALLOWED_ORIGIN = "https://anime-decrypto.pages.dev"
```

如果有预览地址或自定义域名，可以用逗号分隔：

```toml
ALLOWED_ORIGIN = "https://anime-decrypto.pages.dev,https://game.example.com"
```

修改后重新部署 Worker：

```bash
npm run worker:deploy
```

当前 Worker 会返回：

```text
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: content-type,x-decrypto-session
Access-Control-Allow-Methods: GET,POST,OPTIONS
Access-Control-Max-Age: 86400
```

这能减少重复 CORS preflight。长期如果使用自定义域名，推荐让 API 走同源 `/api/*`，进一步减少 OPTIONS。

## 5. 部署 Pages 前端

进入 Cloudflare Dashboard：

```text
Workers & Pages -> Create application -> Pages -> Import an existing Git repository
```

选择仓库后，构建配置：

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
```

环境变量：

```text
VITE_API_BASE_URL=https://anime-decrypto-api.<your-name>.workers.dev
```

然后部署。

如果手动部署 Pages：

```bash
npm run build
npx wrangler pages deploy dist --project-name anime-decrypto
```

## 6. 更新部署

代码改动后通常需要：

```bash
npm run build
npm run worker:deploy
```

如果 Pages 走 GitHub 自动部署，push 到对应分支即可触发前端部署；Worker 仍需要 `npm run worker:deploy`。

如果 Pages 手动部署，则再执行：

```bash
npx wrangler pages deploy dist --project-name anime-decrypto
```

## 7. 低 request 验收

部署后建议用 4 个浏览器窗口打一小局，观察：

- UI 是否在一个窗口操作后立即同步到其他窗口。
- Dev 模式右下角 `ws-action` 是否随操作增长。
- Dev 模式右下角 `action` 是否很少增长；它只应在 WebSocket 不可用时作为 HTTP 回退。
- `snapshot` 和 `fallback` 不应持续快速增长。
- Cloudflare logs 中正常游戏操作不应大量出现 `POST /api/rooms/:id/action`。
- Cloudflare Worker request 数应主要来自 session、create/join、WebSocket 握手和少量 snapshot，而不是每个游戏动作。

当前低 request 设计依赖：

- 房间内 action 优先通过 WebSocket message 发送。
- Durable Object 回 `action_result` ack。
- 同一个 `clientActionId` 用于 WebSocket 和 HTTP 回退，避免重复执行。
- Durable Object 广播按玩家过滤后的 snapshot。
- 前端不做固定轮询。
- GET 请求减少自定义 header 和 JSON content type。
- CORS preflight 使用 `Access-Control-Max-Age` 缓存。

## 8. 推荐的生产域名方式

最简单方式：

```text
前端 Pages: https://anime-decrypto.pages.dev
后端 Worker: https://anime-decrypto-api.<your-name>.workers.dev
```

如果有自己的域名，推荐最终做成：

```text
https://game.example.com        -> Pages 前端
https://game.example.com/api/*  -> Worker API
```

同源 `/api/*` 可以减少 CORS 和 OPTIONS。具体做法取决于域名和 Cloudflare 路由配置；没有自定义域名时，继续使用 Pages + workers.dev 是可行的。

## 9. 部署后验收流程

至少验收这些流程：

1. 打开 Pages 地址，输入昵称。
2. 创建房间，确认生成 6 位房间码。
3. 用 4 个浏览器窗口或无痕窗口加入同一房间。
4. 两队分别坐到 1、2 号位。
5. 房主开始游戏，进入词语分配阶段。
6. 两队确认 4 个词语。
7. 两队加密者看到自己的密码，另一队看不到。
8. 两队提交 3 条线索后进入解密阶段。
9. 两队解码者提交己方密码后进入拦截阶段。
10. 第一轮可由房主跳过拦截，之后进入结算。
11. 推进下一轮，确认身份轮换和状态同步正常。
12. 刷新页面后仍能看到当前房间状态。

## 10. 常见问题

### 页面能打开，但操作失败

检查 Pages 环境变量：

```text
VITE_API_BASE_URL
```

它必须是 Worker 的完整地址，除非你已经配置了同源 `/api/*`。

### 浏览器控制台出现 CORS 错误

检查 Worker 的：

```toml
ALLOWED_ORIGIN
```

它必须包含当前前端页面的 origin，例如：

```text
https://anime-decrypto.pages.dev
```

修改后重新部署：

```bash
npm run worker:deploy
```

### WebSocket 连接失败或其他窗口不实时刷新

检查 Cloudflare logs 中是否有：

```text
GET /api/rooms/:id/ws
匿名会话不存在
```

当前实现会把 session query/header 转发到 Durable Object。若仍出现该错误，优先检查：

- 前端是否使用最新部署。
- Worker 是否已重新部署。
- `VITE_API_BASE_URL` 是否指向当前 Worker。
- 浏览器是否阻止了跨站 cookie；前端也会通过 query session 兜底。

### Cloudflare Worker request 数突然变高

优先检查：

- 是否大量出现 `POST /api/rooms/:id/action`。正常情况下房间内 action 应走 WebSocket。
- 是否大量出现 `GET /api/rooms/:id/snapshot`。这通常表示 WebSocket 不稳定或 fallback 被触发。
- 是否大量出现 `OPTIONS`。这通常来自跨域和 CORS preflight。
- 是否频繁刷新页面或打开很多独立浏览器。

### Worker 部署失败，提示 D1 database_id 不对

重新执行：

```bash
npx wrangler d1 create anime_decrypto
```

把输出里的 `database_id` 复制回 `wrangler.toml`。

### 房间刷新后丢失

确认远程 D1 迁移已经执行：

```bash
npm run d1:migrate:remote
```

本地开发只执行 `d1:migrate:local` 不会影响线上数据库。

### Windows 下 npx/wrangler 命令被 PowerShell 拦截

可以使用 `.cmd` 入口：

```powershell
npx.cmd wrangler deploy
npm.cmd run build
```

### Wrangler tail 连接 127.0.0.1 失败

通常是本机代理环境变量导致。检查：

```powershell
Get-ChildItem Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:ALL_PROXY -ErrorAction SilentlyContinue
```

如果不用代理，可以临时清掉：

```powershell
Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
```
