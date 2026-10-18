# Lubi Web（独立试用版）

单用户 Web 基础工程。与原 Obsidian 插件 **不共享数据、不自动同步**；尚未实现 v14 完整模型、重复规则编辑、原插件数据迁移、SQLite 在线备份和生产登录防护。不要导入真实 Vault 或公开部署此试用版。

## 环境

Node.js 24+（使用内置 `node:sqlite`），npm。数据库默认写入项目根目录的 `data/lubi.db`，已忽略于 Git。

## 本地启动

1. `npm install`
2. 从 `.env.example` 复制环境变量模板，**不要提交自己的密码**。在启动 API 的终端设置 `LUBI_PASSWORD`（至少 16 字符）。可选设置 `LUBI_DB_PATH`、`HOST`、`PORT`。通过 Vite 本地代理登录还需设置 `LUBI_DEV_ORIGINS=http://127.0.0.1:5173`（只在本机开发时设置）。
3. 两个终端分别执行 `npm run dev:api` 和 `npm run dev:web`。
4. 在本机访问 Vite 输出的地址（通常是 `http://127.0.0.1:5173`），登录后可创建项目、按项目查看当天任务、创建每日/每周/每月重复任务、逐次完成任务、添加/删除时间记录。Vite 将 `/api` 代理到本机端口 3000。

Windows PowerShell 示例：`$env:LUBI_PASSWORD='换成自己独有的长密码'; $env:LUBI_DEV_ORIGINS='http://127.0.0.1:5173'; npm run dev:api`。另开终端运行 `npm run dev:web`。`.env.example` 仅作模板，应用**不会自动加载** `.env` 文件。

## 检查

`npm run build` 执行 TypeScript 检查并打包前端；`npm test` 运行基础规则测试。API 当前由 `tsx` 运行源码，不是独立的生产 bundle。

## 已知边界

- 这是本地基础原型，不是可安全公开部署的正式版：登录会话只存内存，重启失效；尚无登录限速、完善的 CSRF/反代策略、完整数据库迁移系统、SQLite 备份恢复演练与生产静态资源服务。
- 数据库 schema 只覆盖最小项目/任务/时间记录字段，不兼容原插件 v14 完整导入。不要将现有任务文件直接写入此库。有时间记录关联的任务不能直接删除，以免丢失关联。
- 仅开发环境下代理同源访问。部署和迁移实施计划见 [架构文档](docs/mcp-lubi-web-architecture.md)。

重复任务当前仅提供基础规则，跳过/取消跳过仅可通过 API 操作；删除重复任务会删除整条规则。详情见 [重复任务增量](docs/mcp-web-recurrence.md)。

关联任务的新时间记录会保存该任务当时的预计分钟快照，任务后续改预计不会回填旧记录；这还不是原插件完整的实际记录工作流。功能差距见 [对齐状态](docs/mcp-parity-gap.md)。

时间记录现在可以在页面修订事项、日期、开始时间和实际分钟；关联任务与原预计快照保持不变。此操作没有撤销。详见 [记录修订说明](docs/mcp-record-revision.md)。

页面已增加周／月实际投入的基础回顾（记录分钟、覆盖分钟、分类及每日柱形图）；与原插件完整回顾仍不等价。见 [回顾增量](docs/mcp-web-review.md)。

侧栏可手动导出当前 Web 数据 JSON，并通过预览将它恢复到空白 Web 数据库；不兼容原插件数据，也不能替代 SQLite 在线备份。见 [导出说明](docs/mcp-web-export.md)与[恢复说明](docs/mcp-web-restore.md)。

可以选择原插件的 `lubi-data` JSON 进行**只读**兼容性预览，查看尚未支持的字段与风险；没有实际导入入口，不会修改原 Vault。见 [原插件导出预览](docs/mcp-obsidian-import-preview.md)。
