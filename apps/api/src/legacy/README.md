# 历史 Web API 兼容边界

这里保留旧 SQL 项目 / 任务 / 记录接口、旧导入预览和导出协议。它们不是当前 v14 工作区的业务核心。

- 当前业务模型：`packages/plugin-runtime/src/core`。
- 旧 SQL 模型：`@lubi/legacy-domain`（`packages/legacy-domain`）。
- 当前文件、设置与升级入口：上层 `vault.ts` / `vaultRestore.ts`。
- `routes.ts` 保持旧 URL、校验、状态码和 SQL 行为；`import.ts` / `obsidianPreview.ts` 只服务旧协议。

## 不变量

1. 路由直接注册在传入的根 Fastify 实例上，继续受同一鉴权和来源检查保护，不另建绕过鉴权的子应用。
2. `legacyWriteBlocked` 在认证之后判断：完整文件工作区存在时，旧写接口返回 409。空旧工作区仍可按原协议使用和升级。
3. 原表和只读导出保留，不与新文件工作区双写。
4. 导入预览绑定登录会话，退出时清除；应用必须重新校验摘要和空库条件。
5. 仅整理模块位置，未进行数据库迁移或删除旧数据。

不要为了添加当前业务功能而继续扩展旧 SQL 模型。需要变更旧兼容行为时，应单独说明迁移影响并补齐对应回归。
