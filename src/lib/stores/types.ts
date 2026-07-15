// Store 共享类型定义
//
// 该文件作为 stores 目录下各切片共享的类型源头，避免切片与 store.ts
// 之间形成 type-only 循环依赖。所有跨切片共享的纯类型定义应集中存放于此，
// 不引入任何运行时依赖，确保类型层与运行时层解耦。

// 左侧导航分类枚举
// 定义所有支持的侧边栏分类标识，供 CategorySlice、ViewSlice 等切片共享。
// 该类型原定义于 store.ts，迁移至此以打破 store.ts ↔ viewSlice.ts /
// types.ts 的循环依赖链。
export type SidebarCategory =
  | "manuscript"
  | "outline"
  | "codex"
  | "stats"
  | "search"
  | "timeline"
  | "characterGraph"
  | "foreshadowing";
