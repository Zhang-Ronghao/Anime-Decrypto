# 架构说明

## 总览

```text
Browser
  -> Cloudflare Pages static frontend
  -> Cloudflare Worker /api/*
  -> Durable Object room instance
  -> D1 rooms table
```

核心原则：

- 前端只负责 UI、表单状态和调用后端接口。
- Worker 负责会话、CORS、HTTP API 路由和房间请求转发。
- 每个房间对应一个 Durable Object，房间操作串行进入同一个状态机。
- Durable Object 是隐藏信息、权限判断和状态变更的权威来源。
- D1 保存可恢复的房间状态快照和 Bangumi 缓存数据。

## 前端

主要文件：

- `src/App.tsx`：主 UI、房间流程、座位选择、阶段渲染、弱网兜底。
- `src/lib/game.ts`：前端游戏客户端，封装 HTTP、WebSocket、WebSocket action 和 HTTP 回退。
- `src/lib/session.ts`：匿名 session bootstrap。
- `src/types.ts`：前后端共享领域类型。
- `src/lib/utils.ts`：队伍、身份、阶段、猜测格式等工具函数。

前端不会直接写数据库，也不会自己决定隐藏信息能否被读取。

## Worker HTTP API

`worker/index.ts` 同时包含 Worker 入口和 Durable Object 类。

Worker 入口负责：

- `GET /api/session`：创建或恢复匿名 session。
- `POST /api/rooms`：创建房间。
- `GET /api/rooms/join-status`：查询房间加入状态。
- `POST /api/rooms/join`：加入房间、中途加入、观战加入。
- `GET /api/rooms/:id/snapshot`：读取按当前玩家过滤后的房间快照。
- `POST /api/rooms/:id/action`：HTTP action 回退通道。
- `GET /api/rooms/:id/ws`：建立房间 WebSocket。
- `GET /api/rooms/:id/catalog`：分页读取房间 Bangumi 词库。

房间相关请求会被代理到对应 Durable Object。

## Durable Object

Durable Object 是房间权威状态机，负责：

- 保存当前内存态房间。
- 校验房主、队伍、身份、阶段和座位。
- 执行选座、开局、确认词语、提交线索、解密、拦截、结算、推进回合等 action。
- 根据玩家身份过滤隐藏信息。
- 广播 WebSocket snapshot。
- 将完整房间状态快照持久化到 D1。

一个房间一个 Durable Object，天然避免同房间并发写冲突。

## 实时同步与 action

前端连接：

```text
GET /api/rooms/:id/ws?session=<session-id>
```

建立连接后，Durable Object 会立即发送当前玩家可见 snapshot：

```json
{
  "type": "snapshot",
  "revision": 12,
  "snapshot": {}
}
```

房间内游戏操作优先走 WebSocket action：

```json
{
  "type": "action",
  "action": {
    "type": "submitClues",
    "team": "A",
    "clues": ["...", "...", "..."],
    "clientActionId": "session:time:seq:submitClues"
  }
}
```

Durable Object 执行同一套 `applyAction()`，然后回 ack：

```json
{
  "type": "action_result",
  "clientActionId": "session:time:seq:submitClues",
  "data": null
}
```

如果 action 改变状态，`save()` 会给所有连接玩家广播新的、按身份过滤后的 snapshot。前端收到 snapshot 后直接更新 UI，不需要再 GET snapshot。

WebSocket 不可用、发送失败、连接关闭或 4 秒内未收到 ack 时，前端会用同一个 `clientActionId` 回退到 HTTP：

```text
POST /api/rooms/:id/action
```

`clientActionId` 保证回退时不会重复执行已完成的 action。

## 低 request 策略

Cloudflare Workers 的 request 数主要来自 Worker 入站 HTTP/WebSocket 握手。当前实现减少 request 的关键点：

- 正常游戏中的房间 action 走 WebSocket message，不再每次点击都 `POST /action`。
- Durable Object 直接广播 snapshot，前端不按固定频率轮询。
- snapshot GET 只用于初始化、弱网兜底、前台恢复和完整历史。
- WebSocket 断开时先尝试恢复，fallback 只做有限 snapshot 同步。
- GET 请求通过 query session 识别身份，不默认附带自定义 header 和 JSON content type，减少 CORS preflight。
- CORS 响应包含 `Access-Control-Max-Age`，减少重复 OPTIONS。
- 同一浏览器多个标签页通过 BroadcastChannel 选 leader，只保留一个房间 WebSocket。

实际测试中，稳定 WebSocket 下 4 人一局的 Worker request 数可降到几十级，而不是每个 action 都产生 HTTP request。

## D1

核心房间表：

```sql
rooms (
  id text primary key,
  room_code text not null unique,
  state_json text not null,
  created_at text not null,
  updated_at text not null
)
```

房间完整状态以 JSON 快照持久化，`room_code` 作为加入房间的索引。这样能让 MVP 保持简单。后续如果需要排行榜、历史统计或后台管理，可以再拆结构化表。

Bangumi 缓存表：

- `bangumi_source_cache`
- `bangumi_character_cache`

这些表减少重复请求 Bangumi API。

## 权限与隐藏信息

权限检查集中在 Worker/Durable Object：

- 只有房主能开始、终止、重开、踢人、转让房主、修改大厅设置。
- 只有本队加密/拦截者能确认词语、提交线索、提交拦截。
- 只有本队解码者能提交己方解密。
- 观战玩家不能读取队伍词语或当前密码。
- 当前密码只返回给对应回合的加密/拦截者。
- 回合提交结果在结算前会按队伍和阶段过滤。

这些规则不依赖前端隐藏。

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

如果使用自定义域名，长期推荐把 API 放到同源 `/api/*`，进一步减少 CORS 和 OPTIONS。

详细部署步骤见 [`docs/deployment.md`](./deployment.md)。
