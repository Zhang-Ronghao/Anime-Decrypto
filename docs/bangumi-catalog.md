# Bangumi 词库与角色提取

## 这部分解决什么问题

这个项目支持两类 Bangumi 增强能力：

- 从多个 Bangumi 用户收藏或目录的交集生成房间词库。
- 基于动画条目进一步提取角色名，作为选词候选。

对应的 Edge Functions：

- `load-bangumi-catalog`
- `extract-bangumi-characters`

## 当前数据存储

房间词库现在分两层存储：

- `rooms` 保存词库摘要：来源输入、收藏类型、词条数量、更新时间。
- `room_bangumi_catalog_entries` 保存具体条目：`room_id`、`subject_id`、`title`。

这样做是为了避免把大量词条放进 `rooms` 单行 JSON/数组里，也让词库浏览、随机抽词和后续查询更稳定。

旧字段 `bangumi_catalog_entries`、`bangumi_catalog_words` 仍保留迁移兼容，但当前函数会把具体词条写入 `room_bangumi_catalog_entries`。

## `load-bangumi-catalog`

### 用途

房主在大厅阶段载入 Bangumi 动画收藏或目录交集，生成本房间可用的随机词库。

### 输入格式

支持这些输入：

- Bangumi 用户 ID，例如 `123456`。
- Bangumi 用户名，例如 `some_user_name`。
- 用户主页链接，例如 `https://bangumi.tv/user/123456`。
- 收藏夹页面链接，例如 `https://bangumi.tv/anime/list/123456`。
- 目录链接，例如 `https://bangumi.tv/index/12345`。

支持域名：

- `bangumi.tv`
- `bgm.tv`
- `chii.in`

用户收藏还可以选择至少 1 个收藏分类：

- `1`：想看
- `2`：看过
- `3`：在看
- `4`：搁置
- `5`：抛弃

如果没有传收藏分类，函数默认使用 `2`，也就是“看过”。

### 适用场景

- 想用共同看过的动画做词库。
- 想减少无关作品，提升双方共识。
- 想让房间词语更贴近动画圈语境。
- 想用 Bangumi 目录直接指定一个主题词库。

### 部署前提

- Supabase 项目已完成基础部署。
- `schema.sql` 已执行。
- Anonymous Auth 已开启。
- `load-bangumi-catalog` 已部署到当前 Supabase 项目。

### 成功条件

- 调用者必须是房主。
- 房间必须还在 `lobby`。
- 输入必须能解析成有效 Bangumi 用户、用户页面、收藏页面或目录页面。
- 所有来源取交集后至少有 8 个动画条目。

载入成功后：

- `room_bangumi_catalog_entries` 会被替换为新的词库条目。
- `rooms.bangumi_catalog_inputs` 会保存规范化后的来源。
- `rooms.bangumi_catalog_types` 会保存收藏类型。
- `rooms.bangumi_catalog_word_count` 会保存词条数量。
- `rooms.bangumi_catalog_updated_at` 会保存更新时间。

## 大厅词库浏览

前端可以按需查询 `room_bangumi_catalog_entries` 并展示当前房间的词库列表。

这个查询不是房间主快照的一部分，也不持续订阅 Realtime；只有玩家点击浏览词库时才拉取，避免大厅快照带上大量词条。

## 选词阶段如何使用词库

在 `word_assignment` 阶段：

- 加密者可以为本队随机抽取 4 个词。
- 加密者可以替换单个词槽。
- 两队抽词会尽量避免重复。
- 已抽过的词会记录到 `team_words.seen_words`，减少反复抽到同一词的概率。
- 加密者仍可手动编辑最终词语。

如果词库不存在或不足，随机抽词会失败，此时可以手动填写词语，或者终止游戏回到大厅重新载入词库。

## `extract-bangumi-characters`

### 用途

在 `word_assignment` 阶段，根据当前队伍词槽里的动画条目提取角色名候选，帮助加密者把作品标题改成角色名。

### 调用条件

- 房间必须在 `word_assignment`。
- 调用者必须是当前队伍的 `encoder`。
- 当前队伍词语还没确认。
- 词槽需要带有 Bangumi `subjectId` 和来源标题。

### 输入

函数接收：

- `roomId`
- `team`，只能是 `A` 或 `B`

### 返回效果

- 为每个词槽补充最多 12 个角色候选。
- 如果某个条目没提取到角色，会回退到原标题。
- 返回 `failedTitles`，用于提示哪些条目提取失败。
- 前端拿到结果后仍可继续手动编辑，再执行确认。

## 词语反馈

选词阶段还支持队内词语反馈：

- 本队加密者编辑好 4 个词后，可以发起反馈请求。
- 同队非加密者可以对每个词给出接受/不接受。
- 反馈会写入 `team_word_feedback_requests` 和 `team_word_feedback_responses`。
- 如果加密者修改了词语，旧反馈会过期，需要重新请求。
- 反馈仅同队可见，不会泄露给对方。

这个功能不依赖 Bangumi，也可以用于纯手动词语。

## 不部署会怎样

不部署这两个函数，基础游戏仍能运行：

- 创建房间。
- 选座和观战。
- 开局。
- 手动填写词语。
- 请求队友反馈。
- 正常进行回合。

缺少的是自动化增强：

- 不能一键载入 Bangumi 词库。
- 不能自动抽取 Bangumi 角色名。

## 常见失败原因

### `load-bangumi-catalog`

- 函数还没部署到当前 Supabase 项目。
- 当前用户不是房主。
- 房间不在 `lobby`。
- 输入不是支持的用户、收藏夹或目录链接。
- Bangumi 用户或目录不存在。
- 多个来源交集少于 8 个动画条目。
- 前端连错了 Supabase 项目。
- `room_bangumi_catalog_entries` 表不存在，通常是 `schema.sql` 没执行完整。

### `extract-bangumi-characters`

- 函数未部署。
- 房间不在 `word_assignment`。
- 调用者不是本队加密者。
- 当前队伍词语已经确认。
- 当前词槽没有 Bangumi 条目元数据。
- 某些动画条目没有可用角色数据。

## 什么时候建议部署

建议部署：

- 你希望公开演示这个项目。
- 你想突出“动画词库驱动”的特色。
- 你不希望每局都手动录入 8 个词。
- 你希望使用角色名而不是动画标题作为最终词语。

可以先不部署：

- 你只是想先验证基础房间和权限模型。
- 你当前只关心 Supabase 数据流是否跑通。
- 你愿意在选词阶段手动填写词语。
