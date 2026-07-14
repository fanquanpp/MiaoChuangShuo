// 项目创建控制面板组件(左侧栏)
//
// 功能概述：
// 启动器左侧栏,聚合品牌入口、新建项目按钮、模板选择面板、导入按钮、扫描目录控制、
// 版本状态信息。按钮箭头使用 Framer Motion spring 实现展开旋转动画。
//
// 模块职责:
// 1. 品牌区(Logo + 装饰图案)
// 2. 创建全新项目按钮(展开/收起模板选择面板)
// 3. 模板选择面板(3 种标准文体 + 自定义模板)
// 4. 导入按钮(本地目录导入 + 压缩包导入)
// 5. 扫描目录控制(输入框 + 浏览按钮 + 扫描按钮)
// 6. 版本与状态信息(绿点状态指示 + 版本号)

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  FolderSync,
  FolderOpen,
  FolderSearch,
  BookOpen,
  PenLine,
  ArrowRight,
  Loader2,
  RefreshCw,
  X,
  FileText,
  BookMarked,
  Clapperboard,
  Feather,
  Layers,
  Settings,
  FileArchive,
} from "lucide-react";
import {
  PROJECT_TEMPLATES,
  type ProjectType,
  type CustomTemplate,
} from "../../lib/api";
import { useI18n } from "../../lib/i18n";

/** 项目类型图标映射(3 标准文体) */
const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  novel: BookMarked,
  script: Clapperboard,
  essay: Feather,
};

/** ProjectCreationPanel 组件属性 */
export interface ProjectCreationPanelProps {
  /** 当前扫描目录 */
  scanDir: string;
  /** 设置扫描目录 */
  onScanDirChange: (dir: string) => void;
  /** 是否正在扫描 */
  loading: boolean;
  /** 执行扫描 */
  onScan: () => void;
  /** 弹窗选择扫描目录 */
  onBrowseScanDir: () => void;
  /** 清空扫描目录与项目列表 */
  onClearScanDir: () => void;
  /** 导入本地项目(弹窗) */
  onImport: () => void;
  /** 打开压缩包导入对话框 */
  onArchiveImportOpen: () => void;
  /** 当前选中的文体类型(用于模板列表高亮) */
  selectedType: ProjectType;
  /** 选择文体类型回调(打开创建对话框) */
  onTypeSelect: (typeId: ProjectType) => void;
  /** 自定义模板列表 */
  customTemplates: CustomTemplate[];
  /** 选择自定义模板回调(打开创建对话框) */
  onCustomTemplateSelect: (template: CustomTemplate) => void;
  /** 打开模板管理对话框 */
  onManageTemplates: () => void;
  /** 当前应用版本号 */
  appVersion: string;
}

/**
 * 项目创建控制面板
 * 输入: 见 ProjectCreationPanelProps
 * 输出: JSX 左侧栏元素
 * 流程:
 *   1. 顶部渲染品牌 Logo 与装饰图案
 *   2. 中部渲染创建按钮(展开/收起模板选择面板)
 *   3. 模板面板渲染 3 种标准文体 + 自定义模板
 *   4. 渲染导入按钮(本地目录 + 压缩包)
 *   5. 底部渲染扫描目录控制 + 版本状态
 */
export default function ProjectCreationPanel({
  scanDir,
  onScanDirChange,
  loading,
  onScan,
  onBrowseScanDir,
  onClearScanDir,
  onImport,
  onArchiveImportOpen,
  selectedType,
  onTypeSelect,
  customTemplates,
  onCustomTemplateSelect,
  onManageTemplates,
  appVersion,
}: ProjectCreationPanelProps) {
  const { t } = useI18n();
  // 模板选择面板展开状态(组件内部 UI 状态,不影响父组件)
  const [typePanelExpanded, setTypePanelExpanded] = useState(false);

  /**
   * 切换模板选择面板展开状态
   * 输入: 无
   * 输出: 无
   */
  const handleTogglePanel = useCallback(() => {
    setTypePanelExpanded((prev) => !prev);
  }, []);

  /**
   * 关闭模板选择面板
   * 输入: 无
   * 输出: 无
   */
  const handleClosePanel = useCallback(() => {
    setTypePanelExpanded(false);
  }, []);

  /**
   * 选择文体类型并关闭面板
   * 选择后立即关闭面板,触发父组件打开创建对话框
   * 输入: typeId 文体类型标识
   * 输出: 无
   */
  const handleTypeSelect = useCallback(
    (typeId: ProjectType) => {
      onTypeSelect(typeId);
      setTypePanelExpanded(false);
    },
    [onTypeSelect]
  );

  /**
   * 选择自定义模板并关闭面板
   * 选择后立即关闭面板,触发父组件打开创建对话框
   * 输入: template 自定义模板对象
   * 输出: 无
   */
  const handleCustomTemplateSelect = useCallback(
    (template: CustomTemplate) => {
      onCustomTemplateSelect(template);
      setTypePanelExpanded(false);
    },
    [onCustomTemplateSelect]
  );

  return (
    <aside className="w-[30%] min-w-[280px] max-w-[420px] bg-nf-bg-sidebar border-r border-nf-border-light flex flex-col flex-shrink-0 relative z-10">
      {/* 顶部渐变装饰条 */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background:
            "linear-gradient(90deg, var(--fandex-primary), var(--fandex-secondary), var(--fandex-tertiary))",
        }}
      />

      {/* 品牌区域 - 入口按钮(点击展开创建面板) + 小点装饰 */}
      <div className="px-6 pt-8 pb-6 relative overflow-hidden">
        <div className="flex items-center gap-2.5 mb-1.5 relative z-[2]">
          {/* 品牌图标容器:右上角小点装饰 */}
          <div className="relative p-2 bg-fandex-primary/10">
            <PenLine className="w-5 h-5 text-fandex-primary" />
            {/* 小点装饰图案:不占位,绝对定位右上角 */}
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-fandex-secondary" />
            <span className="absolute -top-0.5 -right-2.5 w-1 h-1 rounded-full bg-fandex-tertiary/70" />
          </div>
          <div>
            {/* 品牌名:主显示使用中文「喵创说」,增强可读性与品牌识别 */}
            <h1 className="text-lg font-bold font-display text-nf-text tracking-tight">
              喵创说
            </h1>
            {/* 副标题:使用拼音/英文标识,避免与品牌名重复,符合国际命名规范 */}
            <p className="text-[10px] text-nf-text-tertiary">
              {t("launcher.subtitle")}
            </p>
          </div>
        </div>
        {/* logo 右侧空白装饰图案:呼应品牌笔与点,不影响文字排版
         * 由斜线矩阵 + 渐变小点构成,极低透明度,纯视觉点缀 */}
        <svg
          className="nf-logo-decor"
          viewBox="0 0 90 60"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* 斜线矩阵:精致科技感,呼应品牌几何美学 */}
          {Array.from({ length: 5 }).map((_, i) => (
            <line
              key={i}
              x1={20 + i * 14}
              y1={10}
              x2={10 + i * 14}
              y2={50}
              stroke="currentColor"
              strokeWidth="0.6"
              className="text-fandex-primary"
              opacity={0.5 - i * 0.08}
            />
          ))}
          {/* 渐变小点:星光点缀,呼应品牌图标右上角小点 */}
          <circle cx="78" cy="14" r="1.5" className="text-fandex-secondary" fill="currentColor" />
          <circle cx="84" cy="22" r="1" className="text-fandex-tertiary" fill="currentColor" opacity="0.7" />
          <circle cx="80" cy="32" r="0.8" className="text-fandex-primary" fill="currentColor" opacity="0.5" />
        </svg>
      </div>

      {/* 新建项目按钮 + 类型选择面板 */}
      <div className="px-4 space-y-2 flex flex-col flex-1 min-h-0">
        <button
          onClick={handleTogglePanel}
          className="nf-btn-shine group w-full flex items-center gap-2.5 px-4 py-3 bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse font-medium text-sm transition-all duration-base ease-fandex shadow-sm hover:shadow-md"
        >
          <BookOpen className="w-4 h-4 transition-transform duration-base ease-fandex" />
          {t("launcher.createNew")}
          {/* 箭头:展开时旋转 90 度朝下,使用 Framer Motion spring 实现弹性旋转
           * spring 参数: duration 0.4s, bounce 0.15,符合任务约束 #11 */}
          <motion.span
            className="ml-auto"
            animate={{ rotate: typePanelExpanded ? 90 : 0 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </motion.span>
        </button>

        {/* 文体类型选择面板 - 展开式 */}
        <div
          className={`overflow-hidden transition-all duration-300 ease-fandex flex flex-col ${
            typePanelExpanded ? "flex-1 min-h-0 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="border border-nf-border-light bg-nf-bg/50 mt-2 flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-nf-border-light/50 flex-shrink-0">
              <span className="text-xs font-semibold text-nf-text-secondary">
                {t("project.formTypeLabel")}
              </span>
              <button
                onClick={handleClosePanel}
                className="p-0.5 text-nf-text-tertiary hover:text-nf-text transition duration-fast"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-1.5 overflow-y-auto flex-1 space-y-0.5">
              {PROJECT_TEMPLATES.map((tpl) => {
                const Icon = TYPE_ICONS[tpl.id] || FileText;
                return (
                  <button
                    key={tpl.id}
                    onClick={() => handleTypeSelect(tpl.id)}
                    className={`w-full flex items-start gap-2.5 px-2.5 py-2 text-left transition-all duration-fast hover:bg-fandex-primary/10 group ${
                      selectedType === tpl.id ? "bg-fandex-primary/5" : ""
                    }`}
                  >
                    <Icon className="w-4 h-4 text-fandex-primary/70 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium font-display text-nf-text group-hover:text-fandex-primary transition-colors">
                        {tpl.name}
                      </div>
                      <div className="text-[11px] text-nf-text-tertiary mt-0.5 line-clamp-2 leading-relaxed">
                        {tpl.desc}
                      </div>
                    </div>
                  </button>
                );
              })}

              {/* 自定义模板分隔线 */}
              {customTemplates.length > 0 && (
                <div className="mx-1 my-1.5 border-t border-nf-border-light/40" />
              )}

              {/* 自定义模板列表(不显示冗余箭头图标) */}
              {customTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handleCustomTemplateSelect(tpl)}
                  className="w-full flex items-start gap-2.5 px-2.5 py-2 text-left transition-all duration-fast hover:bg-fandex-secondary/10 group"
                >
                  <Layers className="w-4 h-4 text-fandex-secondary/70 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium font-display text-nf-text group-hover:text-fandex-secondary transition-colors">
                      {tpl.name}
                    </div>
                    <div className="text-[11px] text-nf-text-tertiary mt-0.5 line-clamp-2 leading-relaxed">
                      {tpl.description || tpl.directories.join("、")}
                    </div>
                  </div>
                </button>
              ))}

              {/* 管理自定义模板按钮 */}
              <div className="mx-1 my-1.5 border-t border-nf-border-light/40" />
              <button
                onClick={onManageTemplates}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-all duration-fast hover:bg-nf-bg-hover group"
              >
                <Settings className="w-4 h-4 text-nf-text-tertiary mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-nf-text-tertiary group-hover:text-nf-text-secondary transition-colors">
                    {t("template.manageTemplates")}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* 导入按钮 */}
        <button
          onClick={onImport}
          className="nf-icon-slide nf-border-glow w-full flex items-center gap-2.5 px-4 py-2.5 text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover border border-nf-border-light hover:border-fandex-primary/40 text-sm transition-all duration-base ease-fandex"
        >
          <FolderOpen className="w-4 h-4" />
          {t("launcher.importLocal")}
        </button>

        {/* 从压缩包导入按钮 */}
        <button
          onClick={onArchiveImportOpen}
          className="nf-icon-slide nf-border-glow nf-border-glow-secondary w-full flex items-center gap-2.5 px-4 py-2.5 text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover border border-nf-border-light hover:border-fandex-secondary/40 text-sm transition-all duration-base ease-fandex"
        >
          <FileArchive className="w-4 h-4" />
          {t("archive.importTitle")}
        </button>
      </div>

      {/* 扫描目录区域 */}
      <div className="px-4 pt-6 pb-4 mt-auto">
        <div className="flex items-center gap-1.5 text-xs text-nf-text-tertiary mb-2">
          <FolderSync className="w-3.5 h-3.5" />
          <span className="font-medium">{t("launcher.setScanDir")}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-2">
          <input
            type="text"
            value={scanDir}
            onChange={(e) => onScanDirChange(e.target.value)}
            placeholder={t("launcher.scanDirPlaceholder")}
            className="flex-1 bg-nf-bg border border-nf-border-light px-2.5 py-2 text-xs text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
          />
          <button
            onClick={onBrowseScanDir}
            title={t("launcher.scanDirPlaceholder")}
            className="nf-icon-spin nf-border-glow flex-shrink-0 p-2 text-xs text-nf-text-tertiary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/40 hover:bg-nf-bg-hover transition duration-fast"
          >
            <FolderSearch className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={onScan}
            disabled={!scanDir || loading}
            className="nf-btn-shine group flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 transition-transform duration-500 ease-out group-hover:rotate-[360deg]" />
            )}
            {t("launcher.scanDir")}
          </button>
          {scanDir && (
            <button
              onClick={onClearScanDir}
              className="px-3 py-2 text-xs text-nf-text-tertiary hover:text-nf-text border border-nf-border-light hover:bg-nf-bg-hover transition duration-fast"
            >
              {t("launcher.changeDir")}
            </button>
          )}
        </div>
      </div>

      {/* 版本与状态信息:绿点状态指示 + 结构化版本/离线标识 */}
      <div className="px-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          {/* 状态指示绿点:带柔和呼吸光晕,显示「本地环境就绪」 */}
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          <span className="text-[10px] font-medium text-nf-text-secondary tracking-wide">
            {t("launcher.statusReady")}
          </span>
          <span className="text-[10px] text-nf-text-tertiary/40">·</span>
          <span className="text-[10px] text-nf-text-tertiary tracking-wide">
            {t("launcher.statusOffline")}
          </span>
        </div>
        <p className="text-[10px] text-nf-text-tertiary/70 tabular-nums tracking-wide">
          {t("launcher.statusVersion")} v{appVersion}
        </p>
      </div>
    </aside>
  );
}
