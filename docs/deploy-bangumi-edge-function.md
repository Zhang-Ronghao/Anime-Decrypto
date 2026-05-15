# 部署 Bangumi 词库 Edge Function

本文只说明一件事：把 `load-bangumi-catalog` 部署到 Supabase，让前端“载入并保存词库”按钮能正常工作。

## 前提

- 你已经把 [supabase/schema.sql](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/supabase/schema.sql) 执行到 Supabase。
- 前端环境变量已经正确配置：
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- 当前项目里已经有函数代码：
  - [supabase/functions/load-bangumi-catalog/index.ts](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/supabase/functions/load-bangumi-catalog/index.ts)

## 部署步骤

1. 打开 Supabase Dashboard，进入你的项目。
2. 左侧进入 `Edge Functions`。
3. 点击 `Deploy a new function`。
4. 选择 `Via Editor`。
5. 函数名填写：
   - `load-bangumi-catalog`
6. 打开本地文件 [supabase/functions/load-bangumi-catalog/index.ts](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/supabase/functions/load-bangumi-catalog/index.ts)。
7. 复制文件全部内容。
8. 回到 Supabase 网页编辑器，用这份内容完整替换默认代码。
9. 点击 `Deploy function`。

## 重要说明

- 不需要手动创建 `SUPABASE_SERVICE_ROLE_KEY` secret。
- Supabase 托管的 Edge Functions 默认可读取 `SUPABASE_SERVICE_ROLE_KEY`。
- 如果你在 Secrets 页面手动新增 `SUPABASE_SERVICE_ROLE_KEY`，通常会报错：
  - `Name must not start with the SUPABASE_ prefix`
- 这是正常限制，直接部署函数即可。

## 部署后验证

1. 回到 `Edge Functions` 列表。
2. 确认能看到函数：
   - `load-bangumi-catalog`
3. 刷新前端页面。
4. 进入房间大厅。
5. 房主点击“载入 Bangumi 看过动画词库”。
6. 输入一个有效的 Bangumi 用户 ID，或“看过”页面链接。
7. 点击“载入并保存词库”。

如果成功：

- 房间会显示词库摘要更新：
  - 已配置/未配置
  - 用户数
  - 交集词数
  - 上次更新时间

## 失败排查

如果前端提示：

- `Failed to send a request to the Edge Function`

按下面检查：

1. 确认函数名必须是：
   - `load-bangumi-catalog`
2. 确认你已经点击过 `Deploy function`，不是只保存了编辑器内容。
3. 确认前端连接的是同一个 Supabase 项目。
4. 打开 Supabase Dashboard：
   - `Edge Functions -> load-bangumi-catalog -> Logs`
5. 直接看日志里的报错信息。

常见原因：

- 函数还没部署成功
- 代码没有完整粘贴
- 数据库 SQL 还没迁移完整
- 当前用户不是房主
- 房间不在 `lobby` 阶段
- Bangumi 用户不存在
- 多用户交集词条少于 8 个

## 本功能依赖的行为

- 只有房主能载入词库
- 只有大厅阶段能载入词库
- 至少要得到 8 个交集动画词条才会保存
- 保存后词库写入 `rooms` 表，后续随机抽词直接从房间词库读取
