# Bangumi 词库与角色提取

## 这部分解决什么问题

这个项目支持两类 Bangumi 增强能力：

- 从多个 Bangumi 用户的动画收藏交集生成房间词库
- 基于动画条目进一步提取角色名，作为选词候选

对应的 Edge Functions：

- `load-bangumi-catalog`
- `extract-bangumi-characters`

## `load-bangumi-catalog`

### 用途

房主在大厅阶段载入 Bangumi 动画收藏交集，生成本房间可用的随机词库。

### 输入格式

支持两种输入：

- Bangumi 用户 ID，例如 `790691`
- 收藏夹页面链接，例如 `https://bangumi.tv/anime/list/790691`

支持域名：

- `bangumi.tv`
- `bgm.tv`
- `chii.in`

还需要选择至少 1 个收藏分类。当前函数支持的分类值是：

- `1`
- `2`
- `3`
- `4`
- `5`

前端默认会传收藏分类列表，函数内部会去重和排序。

### 适用场景

- 想用共同看过的动画做词库
- 想减少无关作品，提升双方共识
- 想让房间词语更贴近动画圈语境

### 部署前提

- Supabase 项目已完成基础部署
- `schema.sql` 已执行
- Anonymous Auth 已开启
- `load-bangumi-catalog` 已部署到当前 Supabase 项目

### 成功条件

- 调用者必须是房主
- 房间必须还在 `lobby`
- 输入必须能解析成有效 Bangumi 用户
- 多个用户收藏的动画交集至少要有 8 个条目

载入成功后，函数会把这些数据写回 `rooms`：

- `bangumi_catalog_inputs`
- `bangumi_catalog_types`
- `bangumi_catalog_entries`
- `bangumi_catalog_words`
- `bangumi_catalog_updated_at`

## `extract-bangumi-characters`

### 用途

在 `word_assignment` 阶段，根据当前队伍词槽里的动画条目提取角色名候选，帮助加密者把作品标题改成角色名。

### 调用条件

- 房间必须在 `word_assignment`
- 调用者必须是当前队伍的 `encoder`
- 当前队伍词语还没确认

### 输入

函数接收：

- `roomId`
- `team`，只能是 `A` 或 `B`

### 返回效果

- 为每个词槽补充角色候选列表
- 如果某个条目没提取到角色，会保留原标题
- 前端拿到结果后仍可继续手动编辑，再执行确认

## 不部署会怎样

不部署这两个函数，基础游戏仍能运行：

- 创建房间
- 选座
- 开局
- 手动填写词语
- 正常进行回合

缺少的是自动化增强：

- 不能一键载入 Bangumi 词库
- 不能自动抽取 Bangumi 角色名

## 常见失败原因

### `load-bangumi-catalog`

- 函数还没部署到当前 Supabase 项目
- 当前用户不是房主
- 房间不在 `lobby`
- 输入不是纯数字 ID，也不是支持的收藏夹链接
- Bangumi 用户不存在
- 多人收藏交集少于 8 个动画条目
- 前端连错了 Supabase 项目

### `extract-bangumi-characters`

- 函数未部署
- 房间不在 `word_assignment`
- 调用者不是本队加密者
- 当前队伍词语已经确认
- 某些动画条目没有可用角色数据

## 什么时候建议部署

建议部署：

- 你希望公开演示这个项目
- 你想突出“动画词库驱动”的特色
- 你不希望每局都手动录入 8 个词

可以先不部署：

- 你只是想先验证基础房间和权限模型
- 你当前只关心 Supabase 数据流是否跑通
