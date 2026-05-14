# 解码战项目说明

## 1. 项目目标

这个项目是一个基于桌游 **Decrypto / 解码战** 思路制作的联机网页原型。

目标是：

- 让 4 名玩家通过浏览器联网游玩
- 分成两队，每队固定 1 名出题者、1 名解码者
- 不自建后端服务器
- 使用 Supabase 作为“公共房间状态服务器”
- 不同身份的玩家看到不同信息

这是一版 **MVP / 原型版本**，核心目标是把“能创建房间、能加入、能分角色、能按阶段推进游戏”先做通。

## 2. 技术方案

### 前端

- `React 19`
- `TypeScript`
- `Vite`
- 原生 CSS

前端负责：

- 页面渲染
- 房间创建 / 加入
- 不同玩家身份下的不同界面
- 线索提交、猜测提交
- 订阅 Supabase Realtime 更新并自动刷新界面

### 后端替代方案

没有单独开发 Node.js / Java / Python 后端。

改用：

- `Supabase Auth`
- `Supabase Postgres`
- `Supabase Realtime`
- `Supabase RPC`
- `Supabase Row Level Security (RLS)`

Supabase 在这个项目里承担的角色是：

- 匿名玩家身份系统
- 房间和玩家状态存储
- 游戏回合数据存储
- 实时同步服务
- 权限控制服务

## 3. 联机架构

整体结构如下：

```text
浏览器前端
  ↓
Supabase 匿名登录
  ↓
Supabase Postgres 保存房间和回合状态
  ↓
Supabase Realtime 推送状态变化
```

玩家之间不直接通信。

所有玩家都是：

1. 读取同一个房间的数据
2. 通过受控 RPC 修改房间状态
3. 通过 Realtime 收到其他玩家的操作结果

## 4. 已实现的主要功能

### 4.1 房间与玩家

- 支持创建房间
- 支持加入房间
- 支持自定义 6 位房间码
- 如果不填写房间码，则自动生成房间码
- 支持匿名身份登录，不需要注册账号
- 房间内最多 4 名玩家

### 4.2 队伍与角色

- 固定四个席位：
  - `A 队 / 出题者`
  - `A 队 / 解码者`
  - `B 队 / 出题者`
  - `B 队 / 解码者`
- 玩家可以在大厅阶段点击空位入座
- 同一席位不能被两个人同时占用
- 游戏开始后不能再换座位

### 4.3 游戏流程

已实现的游戏阶段：

```text
lobby
clue
intercept
decode
result
finished
```

对应逻辑：

- `lobby`：玩家进入房间、选择席位
- `clue`：两队出题者提交 3 条线索
- `intercept`：两队解码者猜测对方密码
- `decode`：两队解码者再猜测本队密码
- `result`：公开本轮答案与结果
- `finished`：游戏结束

### 4.4 私密信息显示

已实现按身份显示不同页面内容：

- 只有本队成员可以看到本队 4 个关键词
- 只有当前队伍的出题者可以看到本轮密码
- 其他玩家看不到这些私密信息

### 4.5 实时同步

- 房间状态变化会通过 Supabase Realtime 自动同步
- 玩家加入、入座、开始游戏、提交线索、提交猜测后，其他玩家页面会自动更新

### 4.6 计分与胜负

当前实现了 Decrypto 风格的基础胜负逻辑：

- 成功截获对方 2 次，则获胜
- 本队误传 2 次，则失败

同时页面会显示：

- A 队截获次数
- B 队截获次数
- A 队误传次数
- B 队误传次数

### 4.7 数据库与权限

已实现 Supabase 数据表、RLS 和 RPC。

主要表：

- `rooms`
- `room_players`
- `team_words`
- `round_codes`
- `round_submissions`

主要 RPC：

- `create_room`
- `join_room`
- `update_self_seat`
- `start_game`
- `submit_clues`
- `submit_intercept_guess`
- `submit_own_guess`
- `advance_round`

RLS 负责限制：

- 谁能看到房间数据
- 谁能看到本队关键词
- 谁能看到本轮密码
- 谁能调用受限操作

## 5. 实现方式说明

### 前端状态读取

前端会从 Supabase 读取一个房间的完整快照，包括：

- 房间信息
- 玩家列表
- 本队词语
- 当前回合密码
- 当前回合提交记录

### 前端状态更新

前端不会直接改表。

所有关键操作都通过 RPC 调用完成，例如：

- 创建房间
- 加入房间
- 选席位
- 开始游戏
- 提交线索
- 提交猜测

这样做的原因是：

- 规则集中在数据库函数中
- 比前端直接写表更安全
- 更适合和 RLS 配合

### 房间码问题修复

开发过程中额外完成了两项关键修复：

- 支持“创建房间时使用自定义房间码”
- 修复了 Supabase 函数中 `room_id` / `room_code` 命名冲突导致的加入房间报错

## 6. 当前项目文件结构

关键文件如下：

- [src/App.tsx](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/src/App.tsx)
  - 主界面与主要交互逻辑
- [src/lib/game.ts](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/src/lib/game.ts)
  - Supabase RPC 调用、房间快照读取、Realtime 订阅
- [src/lib/supabase.ts](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/src/lib/supabase.ts)
  - Supabase 客户端与匿名登录
- [supabase/schema.sql](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/supabase/schema.sql)
  - 数据库表、RLS、RPC、Realtime publication
- [README.md](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/README.md)
  - 基础启动说明

## 7. 当前未完成 / 半成品部分

下面这些内容目前还没有完成，或者只做到了半成品程度。

### 7.1 规则完整度不足

- 目前实现的是“受 Decrypto 启发”的基础流程，不是完整桌游规则复刻
- 没有实现更复杂的轮次细节和高级规则变体
- 没有做严格的规则配置项

### 7.2 断线恢复不完整

- 玩家刷新页面后可重新加入房间，但不是完整的断线恢复方案
- 没有做掉线超时、重连提示、自动回座等完整机制

### 7.3 房间生命周期管理不完整

- 没有房间列表
- 没有过期房间清理
- 没有“主动离开房间”或“解散房间”流程

### 7.4 交互与体验仍是原型级

- UI 目前是可用优先，不是完整产品级打磨
- 缺少更细的加载状态、错误提示、引导提示
- 移动端虽然可打开，但没有做深度体验优化

### 7.5 运维与发布未完成

- 还没有写 Vercel / Netlify 的部署文档
- 没有 CI / 自动测试
- 没有正式生产环境监控

## 8. 适合下一步优先补的功能

如果继续开发，建议优先级如下：

1. 完善错误提示和房间内状态提示
2. 做离开房间、重连恢复、房间过期清理
3. 明确并补全完整游戏规则
4. 做部署说明与线上发布

## 9. 当前结论

目前这版已经达到了“可以本地运行、可以多人联机、可以按角色区分可见信息、可以完成一局基础解码战流程”的目标。

它已经是一个可运行原型，但还不是完整成品。

更准确地说，当前状态是：

- **核心联机玩法已跑通**
- **数据权限模型已搭好**
- **产品层功能和规则完整度仍需继续完善**
