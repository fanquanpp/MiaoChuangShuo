// 实体高亮 AC 自动机构建 Hook
//
// 功能概述：
// 监听当前项目变化，调用设定库 API 获取全部结构化实体，
// 将实体名与别名注入 Web Worker 内的 Aho-Corasick 自动机，
// 供 EntityHighlight ProseMirror 插件在编辑器中渲染下划线装饰。
//
// 模块职责：
// 1. 项目切换时重置 Worker 自动机，避免跨项目实体污染
// 2. 调用 listCodexEntities 获取结构化实体（含 UUID 与别名）
// 3. 将 StructuredCodexEntity 转为 Worker 接受的 EntityPattern
// 4. 过滤空名/空别名脏数据，避免 AC 自动机插入空串导致死循环
// 5. 设定库读取失败时清空自动机，编辑器仍可用（仅无高亮）
//
// 设计原则：
// - 副作用唯一职责：构建/重置自动机，不维护任何 UI 状态
// - 通过 cancelled 标志避免竞态写入（项目快速切换场景）
// - AI-Ready：自动机匹配结果由 Worker 触发 `entity:detected` Tauri 事件，
//   供 AI 模块监听场景上下文，本 Hook 不直接处理事件

import { useEffect } from "react";
import { getEntityHighlightClient } from "../lib/entityHighlightClient";
import { listCodexEntities } from "../lib/codexApi";
import type { ProjectInfo } from "../lib/api";

/**
 * 实体高亮 AC 自动机构建 Hook
 * 输入:
 *   currentProject - 当前打开的项目（null 时清空自动机）
 * 输出: 无（纯副作用 Hook）
 * 核心流程:
 *   1. currentProject 为空：立即 reset 自动机会话，避免上次项目残留匹配
 *   2. currentProject 存在：异步调用 listCodexEntities 获取实体列表
 *   3. 将每个实体的 meta（id/name/entityType/aliases）转为 EntityPattern
 *   4. 过滤 entityId/entityName 为空或空白的脏数据
 *   5. 先 reset 再 buildAutomaton，确保旧项目实体不会残留
 *   6. 设定库读取失败时 reset 自动机，编辑器仍可用（仅无高亮）
 * 容错策略:
 *   - cancelled 标志：组件卸载或项目切换时阻止过时写入
 *   - 异常兜底：catch 块内 reset 自动机，避免脏数据状态
 */
export function useEntityHighlightAutomaton(
  currentProject: ProjectInfo | null
): void {
  useEffect(() => {
    let cancelled = false;
    // 无项目上下文：清空自动机，避免上次项目残留匹配
    if (!currentProject) {
      getEntityHighlightClient().reset();
      return;
    }
    /**
     * 异步构建自动机
     * 流程:
     *   1. 读取设定库实体列表
     *   2. 转换为 Worker 接受的 EntityPattern（过滤脏数据）
     *   3. 先重置再构建，防止跨项目实体残留
     */
    const buildAutomaton = async () => {
      try {
        const entities = await listCodexEntities(currentProject.path);
        if (cancelled) return;
        // 将 StructuredCodexEntity 转为 Worker 接受的 EntityPattern
        // 实体名与别名均作为模式串注入（O(N+K) 一次扫描全部匹配）
        // 过滤空名与空别名的脏数据，避免 AC 自动机插入空串导致死循环
        const patterns = entities
          .map((e) => ({
            entityId: e.meta.id,
            entityName: e.meta.name,
            entityType: e.meta.entityType,
            aliases: (e.meta.aliases ?? []).filter((a) => a.trim().length > 0),
          }))
          .filter(
            (p) => p.entityId && p.entityName && p.entityName.trim().length > 0
          );
        // 先重置再构建：防止旧项目实体残留造成跨项目误高亮
        getEntityHighlightClient().reset();
        await getEntityHighlightClient().buildAutomaton(patterns);
      } catch {
        // 设定库读取失败：清空自动机，编辑器仍可用（仅无高亮）
        if (!cancelled) getEntityHighlightClient().reset();
      }
    };
    buildAutomaton();
    return () => {
      cancelled = true;
    };
  }, [currentProject]);
}
