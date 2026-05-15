# 架构说明

## 项目目标

这个项目是一个可直接公开部署的网页多人解码战原型。

核心目标：

- 用浏览器完成多人同房对战
- 不同玩家看到不同信息
- 不自建传统后端服务
- 把房间状态、权限、实时同步集中放在 Supabase

## 当前玩法流程

当前代码中的阶段流转是：

```text
lobby -> word_assignment -> encrypt -> decode -> intercept -> result -> finished
```

各阶段职责：

- `lobby`：创建房间、加入房间、选队伍和席位、调整席位数、切换身份轮换、配置 Bangumi 词库
- `word_assignment`：两队加密者确认本队 4 个词，可随机抽词、替换单个词、手动编辑，也可从动画标题提取角色名
- `encrypt`：两队当前加密者看到本轮密码并提交 3 条提示
- `decode`：两队解码者先猜本队密码
- `intercept`：两队解码者再猜对方密码；首轮支持跳过拦截
- `result`：公开本轮答案和得分，房主决定是否推进下一轮
- `finished`：公布胜负，房主可重新开始

## 前后端职责

前端负责：

- 房间 UI、席位选择、阶段界面切换
- 调用 RPC 和 Edge Functions
- 拉取房间快照
- 订阅 Realtime 刷新页面

Supabase 负责：

- Anonymous Auth
- Postgres 存储房间、词语、密码和提交记录
- RPC 执行所有关键游戏操作
- RLS 控制隐藏信息可见性
- Realtime 把房间变化推送给在线玩家

## 隐藏信息如何实现

这个项目不把“隐藏信息”只当作前端显示问题处理。

主要做法：

- 队伍词语和回合密码拆到独立表中，而不是全部塞进单条房间记录
- 用 RLS 限制谁能读到本队词语、当前密码和阶段内敏感字段
- 前端只通过 RPC 改状态，不直接绕过规则写表

这意味着即使有人自己改前端，也不能轻易读到本不该看到的数据。

## 核心数据表

- `rooms`：房间主状态、阶段、分数、席位数、Bangumi 词库配置
- `room_players`：房间内玩家、队伍、席位、身份、房主标记
- `team_words`：两队 4 个词，以及确认状态和词槽元数据
- `round_codes`：每轮每队的密码和对应加密者
- `round_submissions`：每轮提示、己方猜测、拦截猜测和判定结果

## 核心 RPC

大厅与房主管理：

- `create_room`
- `join_room`
- `leave_room`
- `kick_player`
- `disband_room`
- `update_room_lobby_settings`
- `update_self_seat`

开局与选词：

- `start_game`
- `generate_team_words`
- `replace_team_word_slot`
- `confirm_team_words`

回合流程：

- `submit_clues`
- `submit_own_guess`
- `submit_intercept_guess`
- `skip_first_intercept`
- `advance_round`

收尾控制：

- `restart_room`
- `terminate_game`

## Edge Functions

当前仓库包含两个可选的 Supabase Edge Functions：

- `load-bangumi-catalog`
  - 读取一个或多个 Bangumi 用户的动画收藏
  - 取交集后写回房间词库
- `extract-bangumi-characters`
  - 基于当前词槽里的动画条目提取角色名候选
  - 供加密者在选词阶段进一步编辑和确认

这两个函数都不是基础房间流的前置条件，但会影响自动选词体验。

## Realtime 订阅

前端会同时订阅以下表的变更，并在有更新时重新拉取房间快照：

- `rooms`
- `room_players`
- `team_words`
- `round_codes`
- `round_submissions`

这套策略简单直接，适合当前原型阶段，也方便把权限判断继续留在数据库侧。
