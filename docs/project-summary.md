# 项目摘要

## 一句话说明

Anime Decrypto 是一个基于 React、Vite 和 Supabase 的网页多人截码战原型。前端只负责展示和调用接口，房间状态、权限、实时同步和隐藏信息主要放在 Supabase 里处理。

## 当前能力

- 房间：创建、加入、自定义房间码、房主转让、踢人、解散、离开。
- 大厅：可变席位、队伍入座、观战、清空座位、身份轮换、阶段倒计时、胜负规则、中途加入开关。
- 玩法：词语分配、加密、解码、拦截、结算、结束、重开、终止。
- 选词：手动填写、Bangumi 随机抽词、替换词槽、角色提取、队内词语反馈。
- 实时：房间、玩家、词语、回合、反馈和个人通知会通过 Realtime 同步。
- 权限：关键写操作走 RPC，隐藏信息通过表拆分和 RLS 控制。

## 当前阶段流

```text
lobby -> word_assignment -> encrypt -> decode -> intercept -> result -> finished
```

## 主要文件

- [`src/App.tsx`](../src/App.tsx)：主 UI 和交互流程。
- [`src/lib/game.ts`](../src/lib/game.ts)：Supabase RPC、查询、Realtime 订阅和 Edge Function 调用。
- [`src/types.ts`](../src/types.ts)：前端领域类型。
- [`src/lib/utils.ts`](../src/lib/utils.ts)：队伍、席位、身份、阶段和猜测格式化工具。
- [`supabase/schema.sql`](../supabase/schema.sql)：表、RLS、RPC、Realtime 发布配置。
- [`supabase/functions/load-bangumi-catalog/index.ts`](../supabase/functions/load-bangumi-catalog/index.ts)：Bangumi 词库载入。
- [`supabase/functions/extract-bangumi-characters/index.ts`](../supabase/functions/extract-bangumi-characters/index.ts)：Bangumi 角色提取。

## 当前边界

- 没有聊天系统。
- 断线重连和房间清理仍是基础实现。
- 倒计时不自动强制提交。
- Bangumi Edge Functions 是增强功能，不是基础游戏必需。
