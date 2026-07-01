// 场景化叙事工作台组件
//
// 功能概述：
// 喵创说 的场景化叙事辅助面板，以 yWriter 风格管理章节内场景的叙事字段。
// 作为编辑器底部可折叠面板，解析当前文件的 `## 场景N：标题` 标记，
// 为每个场景提供 Viewpoint/Goal/Conflict/Outcome 字段编辑。
//
// 模块职责：
// 1. 解析当前编辑文件中的场景标记
// 2. 渲染场景卡片列表，每卡含 4 核心字段 + 备注
// 3. 字段编辑后自动保存到 .novelforge/scenes/ 元数据
// 4. 支持折叠/展开，避免占用编辑器空间
// 5. 支持点击场景卡片跳转到文件对应位置（MVP 暂不实装）

import { useEffect, useState, useCallback } from "react";
import {
  Clapperboard,
  ChevronDown,
  ChevronRight,
  Eye,
  Target,
  Swords,
  Flag,
  StickyNote,
  Inbox,
  Loader2,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import {
  listScenes,
  updateSceneField,
  SCENE_FIELDS,
  type SceneMeta,
} from "../lib/sceneApi";

// 场景字段图标映射
const FIELD_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  viewpoint: Eye,
  goal: Target,
  conflict: Swords,
  outcome: Flag,
  notes: StickyNote,
};

/**
 * 场景化叙事工作台组件
 * 输入:
 *   filePath 当前编辑文件的相对路径（可选）
 * 输出: JSX 可折叠的场景字段编辑面板
 * 流程:
 *   1. 监听 filePath 变化，调用后端 list_scenes 获取场景列表
 *   2. 渲染场景卡片列表，每卡含 5 个字段输入框
 *   3. 字段失焦时调用 update_scene_field 保存
 *   4. 支持整体折叠/展开
 */
export default function SceneWorkbench({ filePath }: { filePath: string | null }) {
  const currentProject = useAppStore((s) => s.currentProject);
  const { showToast } = useToast();
  const { t } = useI18n();

  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(new Set());

  // 加载场景列表
  // 对空文件或无场景标记的文件静默处理:无场景是正常状态,不应弹出错误提示
  const loadScenes = useCallback(async () => {
    if (!currentProject || !filePath) {
      setScenes([]);
      return;
    }
    setLoading(true);
    try {
      const meta = await listScenes(currentProject.path, filePath);
      setScenes(meta.scenes);
      // 默认展开第一个场景
      if (meta.scenes.length > 0) {
        setExpandedSceneIds(new Set([meta.scenes[0].id]));
      }
    } catch {
      // 静默处理:空文件、无场景标记、或元数据不存在均属正常状态
      // 仅清空场景列表,不弹出错误提示,避免干扰用户
      setScenes([]);
    } finally {
      setLoading(false);
    }
  }, [currentProject, filePath]);

  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  // 切换单个场景的展开状态
  const toggleSceneExpand = useCallback((sceneId: string) => {
    setExpandedSceneIds((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) {
        next.delete(sceneId);
      } else {
        next.add(sceneId);
      }
      return next;
    });
  }, []);

  // 字段失焦时保存
  const handleFieldBlur = useCallback(
    async (sceneId: string, fieldName: string, value: string) => {
      if (!currentProject || !filePath) return;
      try {
        const meta = await updateSceneField(
          currentProject.path,
          filePath,
          sceneId,
          fieldName,
          value
        );
        setScenes(meta.scenes);
      } catch (e) {
        showToast("error", t("scene.saveFailed", { error: String(e) }));
      }
    },
    [currentProject, filePath, showToast, t]
  );

  // 无文件时隐藏
  if (!filePath) return null;

  return (
    <div className="border-t border-nf-border-light bg-nf-bg-panel">
      {/* 头部：标题 + 折叠按钮 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        <Clapperboard className="w-3.5 h-3.5 text-fandex-tertiary" />
        <span>{t("scene.title")}</span>
        {scenes.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-fandex-tertiary/10 text-fandex-tertiary">
            {scenes.length}
          </span>
        )}
      </button>

      {/* 场景列表 */}
      {expanded && (
        <div className="px-4 pb-3 max-h-[280px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-nf-text-tertiary">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-xs">{t("scene.loading")}</span>
            </div>
          ) : scenes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-nf-text-tertiary">
              <Inbox className="w-6 h-6 mb-1.5 opacity-50" />
              <span className="text-xs">{t("scene.empty")}</span>
              <span className="text-[10px] mt-0.5 opacity-70">{t("scene.emptyHint")}</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {scenes.map((scene) => {
                const isExpanded = expandedSceneIds.has(scene.id);
                return (
                  <div
                    key={scene.id}
                    className="border border-nf-border-light overflow-hidden bg-nf-bg-sidebar"
                  >
                    {/* 场景头 */}
                    <button
                      onClick={() => toggleSceneExpand(scene.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-nf-bg-hover transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 flex-shrink-0" />
                      )}
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-fandex-tertiary/10 text-fandex-tertiary font-medium">
                        {scene.index}
                      </span>
                      <span className="flex-1 text-left text-nf-text truncate font-medium">
                        {scene.title || t("scene.untitled")}
                      </span>
                    </button>

                    {/* 场景字段 */}
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 space-y-2 border-t border-nf-border-light/50">
                        {SCENE_FIELDS.map((field) => {
                          const Icon = FIELD_ICONS[field.key] || StickyNote;
                          return (
                            <div key={field.key} className="flex items-start gap-2">
                              <div className="flex items-center gap-1.5 w-16 flex-shrink-0 pt-1.5">
                                <Icon className="w-3 h-3 text-nf-text-tertiary" />
                                <span className="text-[10px] text-nf-text-tertiary">
                                  {field.label}
                                </span>
                              </div>
                              <input
                                type="text"
                                defaultValue={scene[field.key]}
                                onBlur={(e) =>
                                  handleFieldBlur(scene.id, field.key, e.target.value)
                                }
                                placeholder={field.placeholder}
                                className="flex-1 px-2 py-1 text-xs bg-nf-bg-input border border-nf-border-light rounded text-nf-text placeholder:text-nf-text-tertiary/60 focus:outline-none focus:border-fandex-primary transition-colors"
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
