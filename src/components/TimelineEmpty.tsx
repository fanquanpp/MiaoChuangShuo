// src/components/TimelineEmpty.tsx
//
// 时间线编辑器空状态提示组件
// 当画布无节点时显示居中提示文字, 引导用户右键创建首个节点。

import { MousePointerClick } from "lucide-react";
import { useI18n } from "../lib/i18n";

/**
 * 空状态提示组件
 * 输入: 无
 * 输出: JSX 居中提示文字 + 图标
 * 流程: 显示"右键画布添加第一个节点"提示, 无引导图示
 */
export default function TimelineEmpty() {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
      <MousePointerClick className="w-12 h-12 text-nf-text-tertiary opacity-40 mb-3" />
      <p className="text-sm text-nf-text-tertiary">
        {t("timeline.emptyHint")}
      </p>
      <p className="text-xs text-nf-text-tertiary mt-1 opacity-70">
        {t("timeline.emptySubHint")}
      </p>
    </div>
  );
}
