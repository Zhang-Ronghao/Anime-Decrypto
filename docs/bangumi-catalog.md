# Bangumi 词库与角色提取

当前 Cloudflare 版保留了游戏内的 Bangumi 词库入口：

- 大厅可点击「设置词库」，在「词库设置」中调整来源后点击「应用词库」。
- 大厅可浏览当前房间词库。
- 新房间默认启用 2005—2026 年收藏人数前 1000 的热门动画词库，无需手动载入；未配置词库的旧大厅也会补上默认词库。
- 热门词库固定显示在来源列表首位，仍可取消勾选、调整年份和数量，数量上限为 3000；个人收藏和目录可继续参与交集/并集。
- 个人来源点击「添加个人收藏或目录」后展开，交集/并集说明显示在热门词库上方；收藏状态放在来源列表底部，仅用户收藏来源显示。删除全部个人来源后恢复简洁视图。
- 词语分配阶段可随机生成词语。
- 开启角色提取后，可把动画标题转换成角色名候选。

## 当前实现

前端入口集中在 [`src/lib/game.ts`](../src/lib/game.ts)：

- `loadBangumiCatalog`
- `fetchBangumiCatalogWords`
- `generateTeamWords`
- `replaceTeamWordSlot`
- `extractBangumiCharacters`

后端实现集中在 [`worker/index.ts`](../worker/index.ts)。

数据来源：

- Bangumi 用户收藏 API
- Bangumi 目录 API
- 仓库内置热门动画离线榜单：[`worker/data/bangumi-popular-anime.ts`](../worker/data/bangumi-popular-anime.ts)

词库会随房间状态一起保存在 D1 的房间快照中。Bangumi API 结果和角色提取结果会写入 D1 缓存表：

- `bangumi_source_cache`
- `bangumi_character_cache`

## 请求控制

Bangumi 相关操作通常发生在大厅或词语分配阶段，不属于每轮的高频动作。

当前 request 控制策略：

- 载入词库是一次房间 action，正常情况下通过 WebSocket action 执行。
- 浏览词库使用分页 `GET /api/rooms/:id/catalog`，不会一次返回全部词条。
- 用户收藏和目录结果会写入 D1 缓存，避免同一来源反复请求 Bangumi。
- 角色名提取结果会按 subject id 缓存，避免重复请求 Bangumi legacy API。
- GET 请求通过 query session 识别身份，尽量减少 CORS preflight。

## 后续增强方向

如果要继续增强 Bangumi 能力，建议：

1. 把热门榜单数据拆成 D1 表或 Worker 静态资产，进一步减小 Worker bundle。
2. 对 Bangumi API 增加更明确的限流、重试和错误提示。
3. 给词库载入加进度反馈，避免大收藏用户等待时误以为卡住。
4. 给词库浏览增加更细的搜索和筛选能力。

整体数据流保持：

```text
前端 -> Worker -> Durable Object -> D1
```
