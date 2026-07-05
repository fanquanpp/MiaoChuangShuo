// 场景定位工具模块 (AI-2.2)
//
// 功能概述:
//   提供 getCurrentSceneLocation 函数, 基于 ProseMirror 文档树定位光标所在的场景.
//   场景由"场景分隔节点"划分, 兼容两种节点类型:
//     - sceneBreak (自定义节点, 见 src/lib/sceneBreak.ts, 新项目首选)
//     - horizontalRule (TipTap 内置节点, NovelEditor 当前实际注册)
//   定位结果供 AI-2 上下文组装 (context_assembler.rs) 使用, 实现精准的"当前场景"提取.
//
// 模块职责:
//   1. 遍历文档顶层块级节点, 识别场景分隔节点位置
//   2. 根据光标位置判定所属场景索引 (0-based)
//   3. 计算场景文本范围 (startPos / endPos), 供后端提取场景正文
//   4. 提取场景元数据 (sceneBreak 节点的 attrs.sceneType; 未来可扩展 pov/mood)
//
// 设计说明:
//   - 场景索引定义: 第 N 个场景分隔节点之后到第 N+1 个分隔节点之前的内容属于"场景 N"
//     (即分隔节点本身是场景的起点, 不是上一场景的终点)
//   - 光标位于分隔节点之前 (文档开头且无前置分隔) 视为场景 0
//   - 光标位于最后一个分隔节点之后视为最后一场景
//   - 若文档中无任何分隔节点, 整个文档视为场景 0
//   - sceneBreak 节点的 attrs 可携带 sceneType / pov / mood (未来扩展),
//     此处仅透传 sceneNodeId 供后端查询, 不做语义解析

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "prosemirror-model";

/**
 * 场景分隔节点类型集合
 * 兼容 sceneBreak (自定义) 与 horizontalRule (TipTap 内置)
 */
const SCENE_BREAK_NODE_TYPES = new Set<string>(["sceneBreak", "horizontalRule"]);

/**
 * 场景位置信息
 * - sceneIndex: 场景索引 (0-based)
 * - sceneNodeId: 场景分隔节点的唯一标识 (sceneBreak 节点 id, 若存在; 否则为空字符串)
 * - startPos: 场景在文档中的起始位置 (ProseMirror 偏移量, 含分隔节点本身)
 * - endPos: 场景在文档中的结束位置 (下一分隔节点起点或文档末尾)
 * - sceneType: 场景分隔样式 (仅 sceneBreak 节点携带, horizontalRule 返回 "hr")
 */
export interface SceneLocation {
  sceneIndex: number;
  sceneNodeId: string;
  startPos: number;
  endPos: number;
  sceneType: string;
}

/**
 * 判断节点是否为场景分隔节点
 * 输入: node ProseMirror 节点
 * 输出: boolean 是否为场景分隔节点
 * 流程: 检查 node.type.name 是否在 SCENE_BREAK_NODE_TYPES 集合中
 */
function isSceneBreakNode(node: PMNode): boolean {
  return SCENE_BREAK_NODE_TYPES.has(node.type.name);
}

/**
 * 获取当前光标所在的场景信息
 * 输入: editor TipTap Editor 实例
 * 输出: SceneLocation 或 null (光标无效或编辑器未初始化时返回 null)
 * 流程:
 *   1. 读取编辑器当前选区光标位置 (selection.from)
 *   2. 遍历文档顶层块级节点, 记录所有场景分隔节点的偏移量
 *   3. 根据光标位置匹配所属场景索引
 *   4. 计算场景文本范围 (startPos / endPos)
 *   5. 提取场景分隔节点的 attrs (sceneType / id)
 *
 * 关键:
 *   - 使用 doc.nodesBetween 遍历顶层块级节点 (depth=0), 避免深入行内节点
 *   - 分隔节点视为场景起点, 光标在分隔节点之后即属于该分隔节点定义的场景
 *   - 文档开头无分隔节点时, 开头到第一个分隔节点之间视为场景 0 (无分隔前导场景)
 */
export function getCurrentSceneLocation(editor: Editor): SceneLocation | null {
  if (!editor || editor.isDestroyed) return null;

  const { state } = editor;
  const { doc, selection } = state;
  const cursorPos = selection.from;

  // 收集所有场景分隔节点的位置信息
  // boundary: { pos: 分隔节点在文档中的起始偏移, node: 分隔节点本身 }
  const boundaries: Array<{ pos: number; node: PMNode }> = [];

  // 遍历顶层块级节点 (depth=0)
  // pos 为每个顶层节点的起始偏移量
  doc.forEach((node, offset) => {
    if (isSceneBreakNode(node)) {
      boundaries.push({ pos: offset, node });
    }
  });

  // 无分隔节点: 整个文档视为场景 0
  if (boundaries.length === 0) {
    return {
      sceneIndex: 0,
      sceneNodeId: "",
      startPos: 0,
      endPos: doc.nodeSize - 2, // doc.nodeSize 包含开闭标签, 内容范围为 [0, nodeSize-2]
      sceneType: "none",
    };
  }

  // 定位光标所属场景
  // 查找最后一个 pos <= cursorPos 的分隔节点, 该分隔节点定义当前场景
  let currentBoundaryIndex = -1;
  for (let i = 0; i < boundaries.length; i++) {
    if (boundaries[i].pos <= cursorPos) {
      currentBoundaryIndex = i;
    } else {
      break;
    }
  }

  // 光标在第一个分隔节点之前: 视为"前导场景" (场景 0, 无分隔节点起点)
  if (currentBoundaryIndex === -1) {
    const firstBoundary = boundaries[0];
    return {
      sceneIndex: 0,
      sceneNodeId: "",
      startPos: 0,
      endPos: firstBoundary.pos,
      sceneType: "preamble",
    };
  }

  // 光标在某个分隔节点之后: 该分隔节点定义当前场景
  const currentBoundary = boundaries[currentBoundaryIndex];
  const startPos = currentBoundary.pos;
  // 结束位置: 下一分隔节点起点, 或文档末尾
  const endPos =
    currentBoundaryIndex + 1 < boundaries.length
      ? boundaries[currentBoundaryIndex + 1].pos
      : doc.nodeSize - 2;

  // 提取场景分隔节点的元数据
  // sceneBreak 节点携带 attrs.sceneType; horizontalRule 无此属性, 回退为 "hr"
  const sceneType = currentBoundary.node.attrs?.sceneType ?? "hr";
  // sceneBreak 节点未来可携带 attrs.id; 当前无此属性, 返回空字符串
  const sceneNodeId: string = currentBoundary.node.attrs?.id ?? "";

  return {
    sceneIndex: currentBoundaryIndex,
    sceneNodeId,
    startPos,
    endPos,
    sceneType,
  };
}

/**
 * 提取指定场景范围内的纯文本
 * 输入:
 *   editor TipTap Editor 实例
 *   location 场景位置信息 (由 getCurrentSceneLocation 返回)
 * 输出: string 场景内纯文本 (去除分隔节点本身)
 * 流程:
 *   1. 校验 location 有效性
 *   2. 使用 doc.textBetween 提取 startPos 到 endPos 之间的纯文本
 *   3. 分隔节点本身 (block) 使用空行作为块分隔符
 */
export function extractSceneText(
  editor: Editor,
  location: SceneLocation
): string {
  if (!editor || editor.isDestroyed || !location) return "";

  const { doc } = editor.state;
  // textBetween 参数: from, to, blockSeparator
  // blockSeparator 使用 "\n" 分隔块级节点
  // leafText 参数留空, 默认提取叶子节点文本
  try {
    // 跳过分隔节点本身: 从 startPos + 分隔节点大小开始提取
    // 分隔节点是 atom block, nodeSize 为 1 (自身) + 2 (开闭标签) = 3
    // 但 textBetween 会自动跳过 atom 节点, 无需手动偏移
    const text = doc.textBetween(location.startPos, location.endPos, "\n");
    // 去除首尾空白与多余换行
    return text.trim();
  } catch {
    return "";
  }
}
