# 架构说明

## 项目目标

这个项目是一个可公开部署的网页多人截码战原型。

核心目标：

- 用浏览器完成多人同房对战。
- 不同玩家看到不同信息。
- 不自建传统后端服务。
- 把房间状态、权限、实时同步和隐藏信息控制集中放在 Supabase。

## 当前玩法流程

当前代码中的阶段流转是：

```text
lobby -> word_assignment -> encrypt -> decode -> intercept -> result -> finished
```

各阶段职责：

- `lobby`：创建/加入房间、选队选座、观战、房主转让、踢人、调整席位数、身份轮换、阶段倒计时、胜负规则、中途加入开关、Bangumi 词库配置。
- `word_assignment`：两队加密者编辑并确认本队 4 个词；可随机抽词、替换单个词、手动编辑、从动画标题提取角色名，也可向队友请求逐词反馈。
- `encrypt`：两队当前加密者看到本轮密码并提交 3 条提示。
- `decode`：两队解码者先猜本队密码。
- `intercept`：两队加密/拦截者猜对方密码；第一轮支持房主跳过拦截。
- `result`：公开本轮答案和判定结果，房主决定是否推进下一轮。
- `finished`：公布胜负，房主可重新开始。

## 前后端职责

前端负责：

- 房间 UI、席位选择、观战视角、阶段界面切换。
- 调用 Supabase RPC 和 Edge Functions。
- 拉取房间快照。
- 订阅 Realtime 并在表变更后刷新快照。
- 本地展示倒计时、进度、反馈统计和词库浏览。

Supabase 负责：

- Anonymous Auth。
- Postgres 存储房间、玩家、词语、密码、提交记录、反馈记录和通知。
- RPC 执行关键游戏操作。
- RLS 控制隐藏信息可见性。
- Realtime 把房间变化推送给在线玩家。
- Edge Functions 处理 Bangumi 外部 API 调用。

## 隐藏信息如何实现

这个项目不把“隐藏信息”只当作前端显示问题处理。

主要做法：

- 队伍词语、回合密码、提交记录拆到独立表中，而不是全部塞进单条房间记录。
- 用 RLS 限制谁能读到本队词语、当前密码、队内反馈和通知。
- 前端只通过 RPC 改游戏状态，不直接绕过规则写表。
- 观战玩家可以切换视角看公开/允许读取的信息，但不会占用席位，也不能执行队内身份操作。

这意味着即使有人自己改前端，也不能轻易读到本不该看到的数据。

## 核心数据表

- `rooms`：房间主状态、阶段、分数、席位数、倒计时配置、胜负规则、Bangumi 词库配置。
- `room_players`：房间内玩家、队伍、席位、身份、观战标记、房主标记。
- `team_words`：两队 4 个词、词槽元数据、已见过的词、确认状态。
- `round_codes`：每轮每队的密码和对应加密者。
- `round_submissions`：每轮提示、己方猜测、拦截猜测和判定结果。
- `room_bangumi_catalog_entries`：房间 Bangumi 词库条目，按 `room_id + subject_id` 独立存储，避免把大词库塞进 `rooms`。
- `team_word_feedback_requests`：选词阶段加密者发起的队内词语反馈请求。
- `team_word_feedback_responses`：队友对每个词槽的接受/不接受反馈。
- `player_notifications`：个人通知，目前用于被踢出房间。

## 核心 RPC

大厅、加入与房主管理：

- `create_room`
- `join_room`
- `get_room_join_status`
- `join_midgame_room`
- `join_as_spectator`
- `leave_room`
- `transfer_host`
- `kick_player`
- `disband_room`
- `cleanup_expired_rooms`

大厅设置与席位：

- `update_room_lobby_settings`
- `update_self_seat`
- `update_self_spectator`
- `clear_all_seats`

开局与选词：

- `start_game`
- `generate_team_words`
- `replace_team_word_slot`
- `save_team_words`
- `confirm_team_words`
- `request_team_word_feedback`
- `submit_team_word_feedback`
- `submit_team_word_feedback_batch`

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
  - 读取一个或多个 Bangumi 用户收藏或目录。
  - 取交集后写入 `room_bangumi_catalog_entries`，并更新 `rooms` 上的词库摘要字段。
- `extract-bangumi-characters`
  - 基于当前词槽里的 Bangumi 条目提取角色名候选。
  - 供加密者在选词阶段进一步编辑和确认。

这两个函数都不是基础房间流的前置条件，但会影响自动选词体验。

## Realtime 订阅

前端会订阅以下表的变更，并在有更新时重新拉取房间快照：

- `rooms`
- `room_players`
- `team_words`
- `round_codes`
- `round_submissions`
- `team_word_feedback_requests`
- `team_word_feedback_responses`

前端还会订阅 `player_notifications` 中当前登录用户的插入事件，用于处理被踢出的提示。

`room_bangumi_catalog_entries` 主要通过按需查询用于词库浏览，不在房间主订阅中持续监听。

## 近期实现重点

- Bangumi 词库从 `rooms.bangumi_catalog_entries / bangumi_catalog_words` 迁移到独立的 `room_bangumi_catalog_entries` 表，`rooms` 只保留来源、收藏类型、词数和更新时间等摘要字段。
- 房间快照查询改为显式选择字段，回合记录默认只取最近记录，减少不必要的数据读取。
- 选词阶段新增队内词语反馈：加密者发起请求，非加密者对 4 个词逐项给出接受/不接受，反馈只在同队可见。
