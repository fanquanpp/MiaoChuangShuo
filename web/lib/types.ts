// Web 版类型定义
//
// 功能概述:
// 定义在线体验版用到的核心数据类型, 包括项目、章节、ProseMirror JSON 节点。
// 所有类型与桌面版保持概念一致, 但独立定义, 不引用桌面版 src/。
//
// 模块职责:
// 1. 定义 WebProject 项目类型
// 2. 定义 WebChapter 章节类型
// 3. 定义 ProseMirror JSON 文档节点类型 (用于 TipTap 内容存储)
// 4. 定义主题模式类型

// 主题模式类型: 暗色 / 亮色
export type WebThemeMode = "dark" | "light";

// ProseMirror JSON 节点类型 (简化版, 仅描述文档结构)
// 输入: 无
// 输出: 类型定义
// 流程: 定义 doc/paragraph/text 等节点的 JSON 结构, 用于 IndexedDB 持久化
export interface ProseMirrorNode {
  // 节点类型: doc / paragraph / text / heading / bulletList 等
  type: string;
  // 文本内容 (仅 text 节点有)
  text?: string;
  // 子节点 (仅容器节点有)
  content?: ProseMirrorNode[];
  // 节点属性 (如 heading 的 level, text 的 bold/italic 等 marks)
  attrs?: Record<string, string | number | boolean | null>;
  // 标记数组 (仅 text 节点有, 描述 bold/italic 等内联格式)
  marks?: ProseMirrorMark[];
}

// ProseMirror 标记 (内联格式)
export interface ProseMirrorMark {
  // 标记类型: bold / italic / underline / strike / link 等
  type: string;
  // 标记属性 (如 link 的 href)
  attrs?: Record<string, string | number | boolean | null>;
}

// 项目类型 (Web 版简化, 仅保留在线体验所需字段)
export interface WebProject {
  // 项目唯一 ID (UUID)
  id: string;
  // 项目名称
  name: string;
  // 项目类型 (novel/essay/script 等, 仅作展示用)
  type: string;
  // 创建时间 (ISO 字符串)
  createdAt: string;
  // 最后修改时间 (ISO 字符串)
  updatedAt: string;
  // 项目总字数 (所有章节累计)
  wordCount: number;
}

// 章节类型
export interface WebChapter {
  // 章节唯一 ID (UUID)
  id: string;
  // 所属项目 ID
  projectId: string;
  // 章节名称 (如 "第一章 风起")
  name: string;
  // 章节内容 (ProseMirror JSON 文档)
  content: ProseMirrorNode;
  // 章节排序序号 (从 0 开始, 按创建顺序递增)
  order: number;
  // 创建时间 (ISO 字符串)
  createdAt: string;
  // 最后修改时间 (ISO 字符串)
  updatedAt: string;
  // 章节字数
  wordCount: number;
}

// 空白 ProseMirror 文档 (新建章节的默认内容)
// 输入: 无
// 输出: 仅包含一个空段落的 ProseMirror 文档
// 流程: 返回标准的最小文档结构
export function createEmptyDoc(): ProseMirrorNode {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [],
      },
    ],
  };
}
