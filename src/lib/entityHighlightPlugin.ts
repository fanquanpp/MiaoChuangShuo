// 实体高亮 TipTap 扩展：ProseMirror Decoration 渲染
//
// 功能概述：
// 监听编辑器文档变化，提取纯文本发送给 Web Worker（Aho-Corasick 自动机），
// 将返回的匹配位置映射为 ProseMirror Decoration，为实体名添加类型着色下划线。
//
// 模块职责：
// 1. 构建纯文本到 ProseMirror 位置的映射（处理块级边界）
// 2. 防抖触发搜索（避免高频键入导致 Worker 队列堆积）
// 3. 将匹配结果转为 Decoration.inline 装饰
// 4. 通过 transaction meta 更新装饰集合（异步结果不阻塞 apply）
//
// AI-Ready 设计说明：
// 装饰不仅为作者提供视觉反馈，其 data-entity-id 属性可供 HoverCard（p5-26）
// 查询实体详情，并为 AI 场景分析提供"当前段落有哪些实体"的 DOM 可观测数据。

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { getEntityHighlightClient, type EntityMatch } from "./entityHighlightClient";

/**
 * 扩展配置
 */
export interface EntityHighlightOptions {
  /** 是否启用实体高亮 */
  enabled: boolean;
  /** 当前文件路径（传递给 entity:detected 事件） */
  filePath: string;
}

/** 插件键，用于状态读写 */
const entityHighlightKey = new PluginKey<DecorationSet>("entityHighlight");

/** 搜索防抖延迟（毫秒） */
const SEARCH_DEBOUNCE_MS = 200;

/** 实体类型 -> CSS 类名映射 */
const ENTITY_CLASS: Record<string, string> = {
  character: "nf-entity-character",
  worldview: "nf-entity-worldview",
  glossary: "nf-entity-glossary",
  material: "nf-entity-material",
};

/**
 * 文本映射结果
 */
interface TextMapping {
  /** 纯文本（块级边界以换行符分隔） */
  text: string;
  /** posMap[i] = 第 i 个纯文本字符对应的 ProseMirror 位置，-1 表示换行分隔符 */
  posMap: number[];
}

/**
 * 构建纯文本与 ProseMirror 位置的映射
 * 输入: doc ProseMirror 文档节点
 * 输出: TextMapping 包含纯文本与位置映射表
 * 流程:
 *   1. 用 nodesBetween 遍历所有节点
 *   2. 文本节点：逐字符记录 ProseMirror 位置
 *   3. 块级节点（pos > 0）：插入换行符与 -1 哨兵
 * 设计说明:
 *   换行符用于分隔段落/标题等块级节点，防止实体名跨段落匹配。
 *   -1 哨兵在 matchesToDecorations 中被跳过。
 */
function buildTextMapping(doc: PmNode): TextMapping {
  let text = "";
  const posMap: number[] = [];
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.isText) {
      const str = node.text ?? "";
      for (let i = 0; i < str.length; i++) {
        text += str[i];
        posMap.push(pos + i);
      }
    } else if (node.isBlock && pos > 0) {
      // 块级节点边界：插入换行分隔符（首块不插入前导换行）
      text += "\n";
      posMap.push(-1);
    }
    return true;
  });
  return { text, posMap };
}

/**
 * 将 Worker 匹配结果转为 ProseMirror 装饰集合
 * 输入:
 *   matches - Worker 返回的匹配列表
 *   posMap - 纯文本到 ProseMirror 位置的映射表
 *   doc - ProseMirror 文档节点（用于绑定装饰集合）
 * 输出: DecorationSet 装饰集合
 * 流程:
 *   1. 遍历每个匹配，查找对应的 ProseMirror 起止位置
 *   2. 跳过跨块级边界的匹配（posMap 含 -1）
 *   3. 创建 inline 装饰，附带 data-entity-id 与 data-entity-type 属性
 */
function matchesToDecorations(matches: EntityMatch[], posMap: number[], doc: PmNode): DecorationSet {
  const decos: Decoration[] = [];
  for (const m of matches) {
    // 边界检查：匹配范围必须在 posMap 有效区间内
    if (m.start < 0 || m.end > posMap.length || m.start >= m.end) continue;
    const from = posMap[m.start];
    const to = posMap[m.end - 1] + 1;
    // 跳过跨块级边界的匹配（包含 -1 哨兵）
    if (from < 0 || to <= 0) continue;
    // 二次校验：确保范围内的所有位置都有效（不含 -1）
    let hasBoundary = false;
    for (let i = m.start; i < m.end; i++) {
      if (posMap[i] < 0) {
        hasBoundary = true;
        break;
      }
    }
    if (hasBoundary) continue;
    const cls = ENTITY_CLASS[m.entityType] ?? "nf-entity-default";
    decos.push(
      Decoration.inline(from, to, {
        class: cls,
        "data-entity-id": m.entityId,
        "data-entity-type": m.entityType,
      })
    );
  }
  // 绑定文档节点，apply 中 map 操作可基于此文档迁移装饰位置
  return DecorationSet.create(doc, decos);
}

/**
 * 实体高亮扩展
 *
 * 使用方式：
 * ```ts
 * EntityHighlight.configure({ enabled: true, filePath: currentFile })
 * ```
 *
 * 前置条件：
 *   - 必须在注册扩展前调用 getEntityHighlightClient().buildAutomaton(patterns)
 *   - 若自动机为空，搜索返回空列表，不会产生装饰
 */
export const EntityHighlight = Extension.create<EntityHighlightOptions>({
  name: "entityHighlight",

  addOptions() {
    return {
      enabled: false,
      filePath: "",
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    if (!options.enabled) return [];

    const client = getEntityHighlightClient();

    return [
      new Plugin<DecorationSet>({
        key: entityHighlightKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, oldSet) {
            // 显式更新装饰（通过 meta 传递新装饰集合）
            const meta = tr.getMeta(entityHighlightKey);
            if (meta && meta.decorations !== undefined) {
              return meta.decorations as DecorationSet;
            }
            // 文档变更时映射旧装饰到新位置（避免装饰消失后再重建的闪烁）
            if (tr.docChanged) {
              return oldSet.map(tr.mapping, tr.doc);
            }
            return oldSet;
          },
        },
        props: {
          decorations(state) {
            return entityHighlightKey.getState(state) ?? DecorationSet.empty;
          },
        },
        view(view: EditorView) {
          let debounceTimer: ReturnType<typeof setTimeout> | null = null;
          let searchGeneration = 0;
          let disposed = false;

          /**
           * 调度防抖搜索
           * 流程:
           *   1. 清除上一次防抖定时器
           *   2. 延迟 SEARCH_DEBOUNCE_MS 后执行搜索
           *   3. 搜索完成时校验文档未变更（避免陈旧结果污染装饰）
           */
          const scheduleSearch = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              if (disposed) return;
              const generation = ++searchGeneration;
              const docSnapshot = view.state.doc;
              const { text, posMap } = buildTextMapping(docSnapshot);
              // 使用非防抖 search（防抖已在本层完成），触发 entity:detected 事件
              client.search(text, { filePath: options.filePath }).then((matches) => {
                if (disposed) return;
                // 陈旧结果检测：generation 不匹配或文档已变更
                if (generation !== searchGeneration) return;
                if (docSnapshot !== view.state.doc) return;
                const newSet = matchesToDecorations(matches, posMap, docSnapshot);
                // 通过 meta 事务更新装饰集合
                view.dispatch(
                  view.state.tr.setMeta(entityHighlightKey, { decorations: newSet })
                );
              }).catch(() => {
                // 搜索失败保持现有装饰，不影响编辑流程
              });
            }, SEARCH_DEBOUNCE_MS);
          };

          // 初始加载时触发首次搜索
          scheduleSearch();

          return {
            update(view: EditorView, prevState: EditorState) {
              // 仅在文档实际变更时重新搜索（选区变化不触发）
              // 通过对比新旧 doc 引用避免误触发
              if (view.state.doc === prevState.doc) return;
              scheduleSearch();
            },
            destroy() {
              disposed = true;
              if (debounceTimer) clearTimeout(debounceTimer);
              searchGeneration++;
            },
          };
        },
      }),
    ];
  },
});
