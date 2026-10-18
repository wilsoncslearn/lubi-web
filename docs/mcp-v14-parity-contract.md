> 历史设计／阶段记录：当前原插件运行版的使用、架构及验收以 [README](../README.md) 和 [验收记录](验收记录.md) 为准。以下保留原文供追溯。

# 当前未发布版 Lubi → 独立 Web 的同等行为验收契约

基准仅为插件区域，源自当前本地工作区 `src/core/tasks.ts`, `src/core/gantt.ts`, `src/core/planning.ts`；不是 1.7.1 release，也不覆盖原仓库未提交改动。此文件记录**未完成验收要求**，不是完成报告。

## 本轮源码核对发现的硬性差异

| 原插件行为 | 当前 Web 差距 | 验收条件 |
|---|---|---|
| v14 扁平任务，`parent` 表示父子；`project` 兼容旧归属；记录 `blocked`, `start`, `notes`, `order`, `doneAt`, `location`, `executor`, `backgroundRuns`, `outcome`, `archived`, `reschedules`, `budgetMinutes`, `doneLogs`, `origin` | Web 只有精简任务字段，`projectId` 代替原始项目兼容字段 | 数据与表单、列表、筛选、导入导出完整无损，父子/项目转换与旧数据兼容 |
| `occursOn` 非重复任务也显示未安排但 `completedDate(t)` 为指定日的已完成项 | Web 只比较 `date` | 相同任务/日期集合与完成状态 |
| `ganttRows` 对显式起止区间、派生父级汇总、嵌套顺序、重复实例分别投影；`scheduledPlanRows` 保留明确安排的父任务 | Web 每个日期格单纯调用 `occursOn`，显式跨度与派生父节点都可能不显示 | 九种视图/范围组合逐一输出相同任务、区间和顺序 |
| `planDatePatch` 移动显式跨度时整体移动起止日和执行日，保留开始时刻；重复任务不可按单次拖动；`ganttPatch` 调整边界不可排除执行日 | Web 无拖动/调整，PATCH 还拒绝起止区间修改 | UI 拖动/键盘操作及 API 持久化均按同一规则，支持撤销并测边界 |
| `planInbox` 排除由子任务派生的父级摘要、自动记录来源和已完成项 | Web 仅过滤无 `date`/无 `startDate` | 同样未安排数量、排序与层级 |

## 不能假装完成的其他项

原 Markdown 日记的跨夜拆分、支出、待确认、原始行及未知字段保留与撤销；Agent 后台和待审核；趋势/事项/支出回顾；任务 JSON/AI 创建；备份恢复与安全迁移；所有弹窗和响应式视觉逐屏比对。目前仅隔离演示 SQLite，不能写真实 Vault。每一项都须有与原源码/测试对应的自动化断言和浏览器比对，再标记完成。
