# Anime Decrypto

基于 React + Supabase 的网页多人动漫高手——截码战，强调同房不同视角、隐藏信息隔离和低后端成本部署。

在线游玩：<https://anime-decrypto.vercel.app/>

以下文档均有AI生成

## 功能亮点

- 双队对抗。玩家按队伍和席位加入房间，不同身份看到不同信息。
- 隐藏信息不靠前端遮挡。队伍词语、当前密码等敏感数据主要通过表拆分和 Supabase RLS 控制可见性。
- 房间配置可调。大厅阶段支持切换 `4 / 6 / 8 / 10 / 12 / 14` 席，并可开启或关闭身份轮换。
- 词语分配更贴近动画题材。支持从 Bangumi 收藏交集生成词库，并可进一步提取角色名作为词语候选。
- 房主管理完整。支持踢人、解散房间、终止对局、对局结束后重新开始。

## 快速部署

1. 创建一个 Supabase 项目。
2. 在 Supabase SQL Editor 执行 [`supabase/schema.sql`](./supabase/schema.sql)。
3. 在 Supabase Dashboard 开启 Anonymous Auth。
4. 在 Realtime 中把 `rooms`、`room_players`、`team_words`、`round_codes`、`round_submissions` 加入发布。
5. 为前端配置环境变量：

```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

6. 部署前端到 Vercel，或任意能托管 Vite 静态产物的平台。
7. 可选：部署 Bangumi 相关 Edge Functions，让房主可以直接载入 Bangumi 词库并自动提取角色名。

本地启动：

```bash
npm install
npm run dev
```

## 项目现状

- 当前已经实现完整房间流和核心回合流：`lobby -> word_assignment -> encrypt -> decode -> intercept -> result -> finished`
- 支持可变席位、身份轮换、词语确认与替换、Bangumi 词库载入、角色提取、重新开始和终止游戏
- 这是可玩的原型，不是完整商业化产品

## 已知边界

- 没有观战模式
- 没有聊天系统
- 断线重连和房间清理仍是基础实现
- Bangumi 词库属于可选增强，不是基础部署前置
- 未配置 Bangumi 词库也能开局，但选词阶段的随机抽词会失败，此时需要手动填写词语

## 文档导航

- [架构说明](./docs/architecture.md)
- [部署说明](./docs/deployment.md)
- [Bangumi 词库与角色提取](./docs/bangumi-catalog.md)
