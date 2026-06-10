# Bangumi 词库与角色提取

当前 Cloudflare 迁移版保留了游戏内的 Bangumi 词库入口：

- 大厅可打开「载入 Bangumi 动画词库」。
- 大厅可浏览当前房间词库。
- 词语分配阶段可随机生成词语。
- 开启角色提取后，可把动画标题转换成角色名候选。

## 当前实现

旧版本依赖 Supabase Edge Functions 去抓取 Bangumi 数据。迁移到 Cloudflare 后，这部分已经移到 Worker 内：

- 入口函数在 [`src/lib/game.ts`](../src/lib/game.ts)：
  - `loadBangumiCatalog`
  - `fetchBangumiCatalogWords`
  - `generateTeamWords`
  - `replaceTeamWordSlot`
  - `extractBangumiCharacters`
- 后端实现集中在 [`worker/index.ts`](../worker/index.ts)。
- 词库和房间状态一起持久化到 D1 的房间快照里。

当前 Worker 版会直接请求 Bangumi 用户收藏和目录 API，并支持交集/并集。热门榜单入口复用仓库内旧版离线榜单数据。

## 后续如果要增强 Bangumi

建议直接在 Worker 中补：

1. 把热门榜单数据拆成 D1 表或 Worker 资产，进一步减小 Worker bundle。
2. 对 Bangumi API 结果做 D1 或 Cache API 缓存，避免重复请求。
3. 增加失败重试和限流处理。
4. 增加更明确的 Bangumi API 错误提示。

这样可以继续保持：

```text
前端 -> Worker -> Durable Object -> D1
```

不需要重新引入 Supabase Edge Functions。
