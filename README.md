# 解码战

一个基于 `React + Supabase` 的四人联机解码战原型。  
前端负责界面和交互，Supabase 负责匿名身份、房间状态、实时同步和 RLS 隐藏信息。

## 功能范围

- 创建房间 / 加入房间
- 支持房主自定义 6 位房间码；如果留空则自动生成
- 四个固定席位：`A 队出题者`、`A 队解码者`、`B 队出题者`、`B 队解码者`
- 房主开局，系统为两队发 4 个关键词，并为两位出题者生成当前回合密码
- 阶段流转：`lobby -> clue -> intercept -> decode -> result -> ...`
- Realtime 同步房间状态
- 通过 RLS 限制：
  - 只有本队能看到本队关键词
  - 只有当前出题者能看到自己本轮密码
  - 所有人只能通过受控 RPC 改写游戏状态

## 启动方式

1. 安装依赖

```bash
npm install
```

2. 创建 `.env.local`

```bash
VITE_SUPABASE_URL=你的 Supabase URL
VITE_SUPABASE_ANON_KEY=你的 Supabase anon key
```

3. 在 Supabase SQL Editor 执行 [supabase/schema.sql](./supabase/schema.sql)

4. 启动开发环境

```bash
npm run dev
```

## Supabase 要求

- 开启 `Anonymous sign-ins`
- 开启 `Realtime`
- 在 Realtime 中将 `rooms`、`room_players`、`team_words`、`round_codes`、`round_submissions` 加入发布
- 用 `schema.sql` 创建表、RLS 和 RPC

## 当前实现说明

- 这是一个可运行的 MVP，不含观战、断线恢复、聊天、排行榜。
- 目前固定为 `4 人开局`，每队 `1 出题者 + 1 解码者`。
- 游戏结束条件沿用 Decrypto 风格：
  - 某队成功截获对方 2 次，则该队获胜
  - 某队本队误传 2 次，则该队失败，对方获胜
