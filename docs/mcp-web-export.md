> 历史设计／阶段记录：当前原插件运行版的使用、架构及验收以 [README](../README.md) 和 [验收记录](验收记录.md) 为准。以下保留原文供追溯。

# Web 数据 JSON 导出

接口 `GET /api/export` 需已登录会话；页面侧栏“导出 Web 数据 JSON”由用户主动触发下载。服务端同一 SQLite 读取事务内读取**全部**当前 Web `projects`、`tasks`、`records` 行（不采用记录列表的 500 条显示上限）；响应 `Cache-Control: no-store` 和附件文件名。

输出为 `{format:"lubi-web-data",version:1,exportedAt,projects,tasks,records}`。任务含 Web 库中的重复字段与发生日 JSON 字符串；记录含实际分钟和预计快照。它不是原插件的 `lubi-data` 格式，也不包含原 Vault 日记、原插件设置、登录密码或会话。文件含个人数据，应在本机安全保存，不公开分享。

验证：合成数据覆盖未登录拒绝、全部表与关联字段、预计历史快照、响应头及不包含测试密码；`npm run build`、`npm test` 通过。此格式现可预览并恢复到空白 Web 数据库，详见 [恢复说明](mcp-web-restore.md)；仍未做在线 SQLite 备份与恢复演练，不能把 JSON 导出当成完整灾备。
