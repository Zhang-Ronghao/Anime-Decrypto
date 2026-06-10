# Anime Decrypto

基于 React + Cloudflare 的网页多人「动漫高手——截码战」原型。

当前架构：

- React 19 + TypeScript + Vite
- Cloudflare Pages 托管前端
- Cloudflare Workers 提供 API 和 WebSocket
- Durable Objects 管理房间实时状态
- D1 持久化房间状态

## 文档入口

- [游戏教程/规则](./docs/game-rules.md)
- [部署说明](./docs/deployment.md)
- [Bangumi 词库说明](./docs/bangumi-catalog.md)
- [项目摘要](./docs/project-summary.md)

部分历史文档仍保留 Supabase 版本背景；以当前 README 和 [部署说明](./docs/deployment.md) 为准。

## 功能亮点

- 支持创建房间、加入房间、自定义 6 位房间码、房主转让、踢人、解散房间。
- 支持 4、6、8、10、12、14 人座位；4 人房必须满员。
- 支持观战、中途加入、清空座位、身份轮换和房主配置规则。
- 支持阶段倒计时、失误上限、生命模式、重新开始和终止游戏。
- 支持 Bangumi 词库入口、词语反馈、猜测反馈和回合记录。
- 隐藏信息由 Worker/Durable Object 根据玩家身份过滤，不依赖前端隐藏。

## 快速本地启动

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

## 验证命令

```bash
npm run build
npm run worker:typecheck
npx wrangler deploy --dry-run
```

## 当前边界

- 这是可玩的 Web 原型，不是完整商业化产品。
- 断线重连和房间清理仍是基础实现。
- 倒计时主要用于 UI 提示和状态记录，不会自动强制提交或跳阶段。
- Bangumi 用户/目录抓取和热门榜单入口已迁移到 Worker。
