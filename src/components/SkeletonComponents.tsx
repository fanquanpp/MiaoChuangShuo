// 骨架屏组件
//
// 功能概述：
// 提供统一的骨架屏 (Skeleton Screen) 组件，用于加载状态。
// 包含项目卡片骨架、统计卡片骨架、文件列表骨架、文本行骨架等。
// 采用 FANDEX 直角美学，骨架使用主题色动画。

import React from "react";

function SkeletonBlock({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`bg-nf-bg-hover animate-pulse ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({
  width = "100%",
  className = "",
}: {
  width?: string;
  className?: string;
}) {
  return <SkeletonBlock className={`h-3 ${className}`} style={{ width }} />;
}

export function SkeletonLines({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonText
          key={i}
          width={i === lines - 1 ? "60%" : "100%"}
        />
      ))}
    </div>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="bg-nf-bg border-r border-b border-nf-border-light flex flex-col min-h-[168px]">
      <SkeletonBlock className="h-1 w-full" />
      <div className="px-4 pt-4 pb-3 flex-1 flex flex-col">
        <SkeletonBlock className="h-4 w-16 mb-2" />
        <SkeletonBlock className="h-5 w-3/4 mb-3" />
        <div className="mt-auto pt-2.5 border-t border-nf-border-light flex items-center justify-between">
          <SkeletonBlock className="h-3 w-14" />
          <SkeletonBlock className="h-3 w-10" />
          <SkeletonBlock className="h-3 w-16" />
        </div>
      </div>
    </div>
  );
}

// 从外部注入的 t 函数，由 I18nProvider 设置
let _skeletonT = (key: string) => key;
export function setSkeletonI18n(t: (key: string) => string) {
  _skeletonT = t;
}

export function ProjectGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" role="status" aria-label={_skeletonT("skeleton.loading")}>
      {Array.from({ length: count }).map((_, i) => (
        <ProjectCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function StatsCardSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-1 bg-nf-border-light border border-nf-border-light">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-nf-bg-card p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-3 w-12" />
            <SkeletonBlock className="w-4 h-4" />
          </div>
          <SkeletonBlock className="h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

export function FileListItemSkeleton() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-2">
      <SkeletonBlock className="w-4 h-4 flex-shrink-0" />
      <SkeletonBlock className="h-3.5 flex-1" />
      <SkeletonBlock className="h-3 w-12 flex-shrink-0" />
    </div>
  );
}

export function FileListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-0.5" role="status" aria-label={_skeletonT("skeleton.loadingFiles")}>
      {Array.from({ length: count }).map((_, i) => (
        <FileListItemSkeleton key={i} />
      ))}
    </div>
  );
}

export function EditorSkeleton() {
  return (
    <div className="flex-1 flex flex-col bg-nf-bg">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-nf-border-light">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <SkeletonBlock key={i} className="w-7 h-7" />
        ))}
        <div className="ml-auto">
          <SkeletonBlock className="w-20 h-7" />
        </div>
      </div>
      <div className="flex-1 p-8">
        <SkeletonBlock className="h-6 w-1/3 mb-4" />
        <SkeletonLines lines={8} />
      </div>
    </div>
  );
}
