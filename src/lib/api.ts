// 喵创说 后端 API 统一入口（向后兼容 re-export）
//
// 模块职责：
// 本文件为 API 层的聚合入口，仅做 re-export，不包含业务逻辑。
// 所有 API 实现已按领域拆分至 src/lib/api/ 目录下的独立模块：
//   - projectApi.ts    项目 CRUD、自定义模板、导入导出、角色联动、对话框
//   - fileApi.ts       文件读写、创建、删除、重命名、复制
//   - searchApi.ts     全局搜索、全局替换、Tantivy 全文搜索、写作统计
//   - snapshotApi.ts   版本快照创建、列举、读取、恢复、删除、清空
//   - indexApi.ts      Tantivy 索引构建、统计、增量更新、进度监听
//   - aiContextApi.ts  AI 场景/角色/项目上下文组装
//
// 向后兼容说明：
// 现有组件通过 `from "../lib/api"` 导入的代码无需修改，
// 本入口 re-export 所有原导出的函数、类型、接口与常量。
// 新增代码建议直接从分领域模块导入以获得更清晰的依赖关系。

export * from "./api/projectApi";
export * from "./api/fileApi";
export * from "./api/searchApi";
export * from "./api/snapshotApi";
export * from "./api/indexApi";
export * from "./api/aiContextApi";

// 重新导出错误消息提取工具，供组件层统一处理后端 AppError 序列化结构
export { extractErrorMessage } from "./api/_internal";
