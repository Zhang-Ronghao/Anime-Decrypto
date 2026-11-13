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

## 统计数据自动更新

内置词库保存所有有效动画条目的 `subjectId`、名称、年份、评分和收藏总人数；不保存漫画、音乐、游戏等其他类型，也不保存简介、标签和章节等无关内容。收藏人数合计想看、看过、在看、搁置和抛弃五种状态。

数据版本见 [`worker/data/bangumi-popular-anime.meta.json`](../worker/data/bangumi-popular-anime.meta.json)。界面中的数据日期和新房间默认年份上限随该文件更新；已有房间保留原有词库配置和候选词。

[`update-bangumi-catalog.yml`](../.github/workflows/update-bangumi-catalog.yml) 在 GitHub 默认分支每周三北京时间 **08:23** 检查官方 `bangumi/Archive/aux/latest.json`，也可在 Actions 的 **Update Bangumi catalog → Run workflow** 手动运行。定时任务由 GitHub 执行，无需开发者电脑开机，实际启动时间可能受 GitHub 调度影响。

更新流程：

1. 比较快照文件名和生成格式版本；相同则跳过下载。
2. 将全量 ZIP 临时下载到运行机器，验证大小和官方提供的 SHA-256，只解压 `subject.jsonlines`。
3. 按行读取原始记录，保留动画及上述字段，按收藏人数排序生成精简 TypeScript 词库。
4. 检查 JSON、重复 ID、评分字段、最小动画数量及相对上次的数量变化，再运行测试、前端构建和 Worker 类型检查。
5. 通过后仅提交精简词库和版本文件，由现有 Cloudflare Pages / Worker Git 集成部署。原始 ZIP 和 JSON Lines 不提交、不部署；失败时不推送，线上继续使用旧版本。

仓库需启用 GitHub Actions，允许该工作流写入默认分支；若默认分支要求 PR，应按仓库规则调整为更新 PR。Cloudflare 的生产分支和文件监听范围需覆盖这两个数据文件。工作流只使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需额外配置 Bangumi 或 Cloudflare 密钥。

本地手动更新需要 Python 3.10+ 和 Node.js 22+：

```bash
npm run data:update
# 同一快照下修改了生成逻辑时，可强制重新生成
npm run data:update -- --force
```

## 封面按需缓存

候选词的统计信息由 Worker 从离线词库查找，只随该玩家可见的候选词下发，不依赖详情 API。快照中尚未收录的作品仍可选词，只暂缺统计信息。

弹窗出现时，前端通过一次批量 `POST /api/bangumi/covers` 请求最多 16 个作品的封面链接。Worker 先查询 D1 的 `bangumi_source_cache`，键使用独立命名空间 `subject-cover:v1:<id>`：

- 已缓存：直接返回封面链接，不调用 Bangumi。
- 未缓存：最多并发 4 个 Bangumi 详情 API 请求，只提取封面链接并保存；不提前抓取未遇到的作品。
- 成功链接缓存 365 天，缺图或请求失败缓存 10 分钟后允许再试；每个上游请求超时 8 秒。

封面缓存跨玩家、房间和部署复用，每周更新统计数据不会清空封面缓存。图片仍由浏览器直接从 Bangumi 图床加载，加载失败不影响文字、筛选或提交。复用现有 D1 缓存表，无需新增数据库迁移。

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
