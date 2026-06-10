# 架构说明

## 总览

```text
Browser
  -> Cloudflare Pages 静态前端
  -> Cloudflare Worker /api/*
  -> Durable Object room instance
  -> D1 rooms table
```

房间实时状态由 Durable Object 承担。一个房间对应一个 Durable Object 实例，所有玩家操作都串行进入这个实例，因此不会出现两个玩家同时写房间状态导致的并发冲突。

## 前端

前端仍是 Vite + React：

- `src/App.tsx` 保留原 UI 和页面结构。
- `src/lib/game.ts` 是唯一的游戏后端访问层。
- `src/lib/session.ts` 负责匿名会话。

前端不直接写数据库，也不直接决定隐藏信息能否被读取。

## Worker

`worker/index.ts` 负责：

- `/api/session`：创建或恢复匿名会话 cookie。
- `/api/rooms`：创建房间。
- `/api/rooms/join`：加入房间、中途加入、观战。
- `/api/rooms/join-status`：查询房间加入状态。
- `/api/rooms/:id/snapshot`：读取按当前玩家过滤后的房间快照。
- `/api/rooms/:id/action`：执行游戏操作。
- `/api/rooms/:id/ws`：建立房间 WebSocket。
- `/api/rooms/:id/catalog`：读取房间词库标题列表。

## Durable Object

Durable Object 是房间权威状态机，负责：

- 保存当前内存态房间。
- 校验房主、队伍、身份、阶段。
- 处理选座、开局、确认词语、提交线索、解密、拦截、结算和推进回合。
- 根据玩家身份过滤隐藏信息。
- 广播 WebSocket 变更消息。
- 每次状态变更后写入 D1。

## D1

D1 当前只有一个核心表：

```sql
rooms (
  id text primary key,
  room_code text not null unique,
  state_json text not null,
  created_at text not null,
  updated_at text not null
)
```

这样做是为了迁移阶段保持简单：完整房间状态以 JSON 快照持久化，`room_code` 作为加入房间的索引。后续如果需要排行榜、历史统计或后台管理，可以再拆出结构化表。

## 实时同步

前端连接：

```text
/api/rooms/:id/ws
```

当 Durable Object 处理完操作后，会广播：

```json
{
  "type": "changed",
  "tables": ["rooms", "room_players"]
}
```

前端沿用原来的刷新机制：收到变更后重新拉取对应房间快照。这样可以保持 UI 代码稳定，同时把 Supabase Realtime 替换为 Durable Object WebSocket。

## 权限模型

权限检查集中在 Worker/Durable Object：

- 只有房主能开始、终止、重开、踢人、转让房主、修改大厅设置。
- 只有本队加密/拦截者能确认词语、提交线索、提交拦截。
- 只有本队解码者能提交己方解密。
- 观战玩家不能读取队伍词语或当前密码。
- 当前密码只返回给对应回合的加密/拦截者。

## 部署模型

本地：

```text
Vite dev server: http://localhost:5173
Wrangler Worker: http://localhost:8787
VITE_API_BASE_URL=http://localhost:8787
```

线上：

```text
Pages: https://<pages-project>.pages.dev
Worker: https://<worker-name>.<account>.workers.dev
VITE_API_BASE_URL=<Worker URL>
ALLOWED_ORIGIN=<Pages URL>
```

详细部署步骤见 [`docs/deployment.md`](./deployment.md)。
