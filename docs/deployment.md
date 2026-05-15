# 部署说明

## 部署目标

基础部署完成后，读者应当能独立跑起：

- 前端页面
- Supabase 房间状态与权限控制
- 房间创建、加入、选座、开局、回合流转

Bangumi 词库和角色提取是可选增强，不是基础部署前置。

## 1. 准备 Supabase 项目

1. 新建一个 Supabase 项目。
2. 进入 SQL Editor。
3. 执行 [`supabase/schema.sql`](../supabase/schema.sql)。

这一步会创建：

- 核心表
- RLS 策略
- RPC 函数
- Realtime 相关发布配置

## 2. 开启认证与实时能力

在 Supabase Dashboard 中确认：

- `Authentication -> Providers -> Anonymous` 已开启
- Realtime 已启用
- `rooms`、`room_players`、`team_words`、`round_codes`、`round_submissions` 已加入 Realtime 发布

如果这些表没有加入发布，房间状态不会实时刷新。

## 3. 配置前端环境变量

本地或部署平台都需要提供：

```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

本地开发通常放在 `.env.local`。

## 4. 本地验证

安装依赖并启动：

```bash
npm install
npm run dev
```

建议至少验证一次：

- 能匿名进入页面
- 能创建房间
- 第二个浏览器窗口能加入同一房间
- 选座和房间状态能实时同步

## 5. 部署前端

这个项目是标准 Vite 前端，直接部署到 Vercel 即可。

最小流程：

1. 导入 GitHub 仓库
2. Framework Preset 选择 Vite
3. 配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`
4. 触发部署

如果你不用 Vercel，也可以先本地构建再部署静态产物：

```bash
npm run build
```

## 6. 可选部署 Bangumi Edge Functions

如果你希望房主可以在大厅里直接载入 Bangumi 词库，并在选词阶段自动提取角色名，再部署：

- `supabase/functions/load-bangumi-catalog`
- `supabase/functions/extract-bangumi-characters`

部署方式可以用 Supabase CLI，也可以在 Dashboard 的 Edge Functions 界面手动创建并粘贴代码。

这一步不是基础玩法必需：

- 不部署时，房间、选座、回合流程仍可运行
- 只是不能一键载入 Bangumi 词库
- 未配置词库时，随机抽词会失败，需要手动填写词语

## 7. 部署后检查

建议按这个顺序验收：

1. 创建房间并加入多个玩家
2. 调整房间席位数与身份轮换开关
3. 正常开局并进入 `word_assignment`
4. 手动确认两队词语
5. 走完至少一轮 `encrypt -> decode -> intercept -> result`
6. 测试终止游戏和重新开始

如果你还部署了 Bangumi 能力，再额外检查：

1. 大厅能成功载入 Bangumi 词库
2. 选词阶段能随机抽词
3. 角色提取接口可用

## 常见问题

### 页面能打开，但操作一直报权限错误

优先检查：

- `schema.sql` 是否完整执行
- Anonymous Auth 是否开启
- 使用的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 是否来自同一个项目

### 房间状态不自动刷新

优先检查：

- Realtime 是否开启
- 5 张核心表是否都加入了发布

### 可以开局，但随机抽词失败

这通常不是基础部署坏了，而是 Bangumi 词库未配置。

处理方式：

- 先手动填写 4 个词继续游戏
- 或补充部署 Bangumi 相关 Edge Functions，并在大厅里载入词库
