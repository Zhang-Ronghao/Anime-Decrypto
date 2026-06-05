# Anime Decrypto

基于 React + Supabase 的网页多人动漫高手——截码战。

[游戏链接](https://anime-decrypto.vercel.app/)

和群 u 的动漫高手不知不觉也开到 4.0 了，靠 AI 水了个动漫高手版截码战。

持续搜集游戏 idea 中，有好玩的方法欢迎提出！

附上之前的[动漫高手 3.0：一眼顶针（方块猜图）](https://github.com/Davy-Chendy/anime-master-game)。

## 文档入口

- [游戏教程/规则](./docs/game-rules.md)
- [项目架构](./docs/architecture.md)
- [部署说明](./docs/deployment.md)
- [Bangumi 词库与角色提取](./docs/bangumi-catalog.md)
- [项目摘要](./docs/project-summary.md)

以下文档均由 AI 生成。

## 功能亮点

- 支持创建房间、加入房间、自定义 6 位房间码、房主转让、踢人、解散房间。
- 支持 4、6、8、10、12、14 人席位；4 人房必须满员，更多席位可有队员参与讨论。
- 支持观战、中途加入、全体清空座位、身份轮换和房主可配置规则。
- 支持阶段倒计时显示、失误上限、生命模式、重新开始和终止游戏。
- 支持从 Bangumi 用户收藏或目录取交集生成动画词库，并浏览房间词库。
- 支持把动画标题提取成角色名候选，选词阶段可请求队友对 4 个词逐项反馈。
- 关键游戏操作通过 Supabase RPC 执行，隐藏信息主要由表拆分 + RLS 控制。

## 快速部署

1. 创建一个 Supabase 项目。
2. 在 Supabase SQL Editor 执行 [`supabase/schema.sql`](./supabase/schema.sql)。
3. 在 Supabase Dashboard 开启 Anonymous Auth。
4. 在 Realtime 中确认这些表已加入发布：
   `rooms`、`room_players`、`team_words`、`round_codes`、`round_submissions`、`player_notifications`、`team_word_feedback_requests`、`team_word_feedback_responses`。
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
- 当前是可玩的 Web 原型，不是完整商业化产品。
- Bangumi 能力属于增强功能；未部署 Edge Functions 时，基础房间和手动选词仍可运行。

## 已知边界

- 没有聊天系统。
- 断线重连和房间清理仍是基础实现。
- 倒计时主要用于 UI 提示和状态记录，当前不会自动强制提交或跳阶段。
- 未配置 Bangumi 词库也能开局，但随机抽词会失败，此时需要手动填写词语。
