# Cloudflare 部署说明

本项目现在使用：

- 前端：Cloudflare Pages，部署 Vite/React 的 `dist/`
- 后端：Cloudflare Workers，提供 `/api/*`
- 实时房间：Durable Objects，每个房间一个有状态对象
- 持久化：D1，保存房间码索引和完整房间状态快照

不再需要 Supabase URL、Supabase anon key、Supabase RPC、RLS 或 Realtime。

官方参考：

- Cloudflare Pages React 部署：https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
- Cloudflare D1 入门：https://developers.cloudflare.com/d1/get-started/
- Durable Objects 入门：https://developers.cloudflare.com/durable-objects/get-started/
- Workers 路由：https://developers.cloudflare.com/workers/configuration/routing/routes/

## 1. 本地开发

先安装依赖：

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

命令输出里会有一段类似：

```toml
[[d1_databases]]
binding = "DB"
database_name = "anime_decrypto"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把 `database_id` 复制到项目根目录的 `wrangler.toml`，替换：

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

部署成功后，终端会显示一个 Worker 地址，类似：

```text
https://anime-decrypto-api.<your-name>.workers.dev
```

记下这个地址，下一步 Pages 前端要用。

## 4. 配置 Worker CORS

本地默认允许：

```toml
ALLOWED_ORIGIN = "http://localhost:5173"
```

部署到 Pages 后，把 `wrangler.toml` 里的 `ALLOWED_ORIGIN` 改成你的 Pages 地址，例如：

```toml
[vars]
ALLOWED_ORIGIN = "https://anime-decrypto.pages.dev"
```

如果你有预览地址或自定义域名，可以用逗号分隔：

```toml
ALLOWED_ORIGIN = "https://anime-decrypto.pages.dev,https://game.example.com"
```

改完后重新部署 Worker：

```bash
npm run worker:deploy
```

## 5. 部署 Pages 前端

进入 Cloudflare Dashboard：

```text
Workers & Pages -> Create application -> Pages -> Import an existing Git repository
```

选择你的 GitHub 仓库。

构建配置填写：

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
```

环境变量填写：

```text
VITE_API_BASE_URL=https://anime-decrypto-api.<your-name>.workers.dev
```

然后点击部署。

## 6. 推荐的生产域名方式

最简单方式是：

```text
前端 Pages: https://anime-decrypto.pages.dev
后端 Worker: https://anime-decrypto-api.<your-name>.workers.dev
```

如果你有自己的域名，推荐最终做成：

```text
https://game.example.com        -> Pages 前端
https://api.game.example.com    -> Worker 后端
```

这样 `VITE_API_BASE_URL` 填：

```text
https://api.game.example.com
```

也要把 `ALLOWED_ORIGIN` 改成：

```text
https://game.example.com
```

## 7. 部署后验收

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
11. 刷新页面后仍能看到当前房间状态。

## 8. 常见问题

### 页面能打开，但操作失败

检查 Pages 环境变量：

```text
VITE_API_BASE_URL
```

它必须是 Worker 的完整地址，不能是 Pages 地址。

### 浏览器控制台出现 CORS 错误

检查 Worker 的：

```toml
ALLOWED_ORIGIN
```

它必须包含当前前端页面的 origin，例如：

```text
https://anime-decrypto.pages.dev
```

修改后要重新：

```bash
npm run worker:deploy
```

### Worker 部署失败，提示 D1 database_id 不对

重新执行：

```bash
npx wrangler d1 create anime_decrypto
```

把输出里的 `database_id` 复制进 `wrangler.toml`。

### 房间刷新后丢失

确认远程 D1 迁移已经执行：

```bash
npm run d1:migrate:remote
```

本地开发只执行 `d1:migrate:local` 不会影响线上数据库。

### Wrangler 本地运行时提示无法写日志

这是 Windows 权限或沙箱问题，通常不影响线上部署。普通本机终端里执行一般不会出现。如果出现，尝试用普通 PowerShell/CMD 重新运行：

```bash
npm run worker:dev
```

## 9. 当前实现边界

Cloudflare 迁移保留了原有 UI 和核心玩法入口，但有两个实现差异：

- 原 Supabase RLS 已替换为 Worker/Durable Object 内的权限过滤。
- Bangumi 用户/目录抓取和热门榜单入口不再依赖 Supabase Edge Functions，已迁移到 Worker。
