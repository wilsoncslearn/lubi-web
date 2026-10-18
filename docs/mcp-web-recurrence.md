# Web 重复任务第一阶段

本轮把原插件 `src/core/tasks.ts` 的每日/每周/每月发生日规则移植为独立 Web `packages/domain/src/index.ts` 的纯函数；未直接链接原插件仓库。`tasks` 表新增 repeatKind、repeatDays、doneDates、skipDates、startDate、endDate；旧 Web 原型数据库采用只增加列的方式升级，既有任务保留为非重复任务。

- 页面创建任务可选择不重复、每天、每周此日、每月此日。所选日期为重复任务开始日；周/月多选规则暂未提供界面。切换日期时请求当天发生项，点击完成仅变更该次日期。
- API `GET /api/tasks?date=YYYY-MM-DD` 返回未跳过的当日发生项及 `occurrenceDone`；`PATCH /api/tasks/:id/occurrences/:date` 支持 `{done: boolean}` 或 `{skip: boolean}`，跳过后从当日列表移除，可用同一路由取消跳过。重复项不能通过通用任务 PATCH 改全局状态或日期；删除重复任务会删除整条规则，界面弹出确认。
- 完成/跳过按日期独立存储；不会自动写日记或创建时间记录。预计快照、任务/实际关联、父级、完整 schema v14、自然周/月可视化、重复规则编辑仍未实现。原插件非重复任务无日期但有完成日的只读投影也暂未移植。
- 验证：Node 24 下 `npm run build` 与 `npm test` 通过。合成数据覆盖周/月发生日、边界与跳过，API 集成检查旧数据库升级、跨日期完成状态隔离、跳过与取消跳过、无效星期值。未运行真实浏览器或 Obsidian 实机测试。
