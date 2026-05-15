# Anime Decrypto

基于 React + Supabase 的网页多人动漫高手——截码战 

[游戏链接](https://anime-decrypto.vercel.app/) 

和群 u 的动漫高手不知不觉也开到 4.0 了，靠 AI 水了个动漫高手版截码战。

持续搜集游戏 idea 中，有好玩的方法欢迎提出！

附上之前的[动漫高手 3.0：一眼顶针（方块猜图）](https://github.com/Davy-Chendy/anime-master-game)。
## TODO

- 游戏教程/规则 （同截码战规则，这游戏规则好像有点难讲清楚

- 游玩视频（会有吗？

以下文档均由AI生成

## 功能亮点

- 支持从 Bangumi 收藏交集生成词库，支持取多用户收藏夹的交集。
- 支持把动画标题提取成角色名作为词语候选。
- 完整的截码战游戏实现，界面清晰。
- 低后端成本部署。

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
