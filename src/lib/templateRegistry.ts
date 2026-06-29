// 项目模板注册表 — 前端镜像 Rust project_template.rs 的类型专属目录
//
// 功能概述：
// 根据 Rust 后端 project_template.rs 中 type_specific_directories() 的定义，
// 在前端提供相同的类型→专属目录映射，用于侧边栏动态渲染。
//
// 模块职责：
// 1. 定义各项目类型的专属目录列表（与 Rust 保持同步）
// 2. 提供按项目类型获取专属目录的函数

import type { ProjectType } from "./api";

/**
 * 各项目类型的专属目录（与 Rust project_template.rs 保持同步）
 * 这些目录在创建项目时由后端生成，前端侧边栏需动态展示
 */
const TYPE_SPECIFIC_DIRS: Record<ProjectType, string[]> = {
  epic: [
    "势力编年史",
    "地图设定",
    "魔法体系",
    "种族设定",
    "历史年表",
    "语言文字",
  ],
  standard: [
    "卷宗",
    "章节存档",
    "伏笔记录",
    "人物关系图",
  ],
  essay: [
    "灵感碎片",
    "配图素材",
    "引用集锦",
  ],
  script: [
    "场景设定",
    "道具清单",
    "音效提示",
    "分幕大纲",
  ],
  wuxia: [
    "江湖势力",
    "武学体系",
    "地理图志",
    "门派设定",
    "江湖规矩",
    "兵器谱",
  ],
  scifi: [
    "科技设定",
    "星际地图",
    "物种图鉴",
    "文明等级",
    "时间悖论",
    "装备载具",
  ],
  mystery: [
    "案件档案",
    "线索追踪",
    "嫌疑人列表",
    "时间推演",
    "诡计设计",
    "推理逻辑",
  ],
  romance: [
    "情感线",
    "场景地图",
    "人物关系",
    "约会记录",
    "情感节点",
    "对话集锦",
  ],
};

/**
 * 获取项目类型的专属目录列表
 * 输入: 项目类型字符串（来自 ProjectMeta.type）
 * 输出: 专属目录名数组（如未匹配则返回空数组）
 */
export function getTypeSpecificDirs(projectType: string): string[] {
  return TYPE_SPECIFIC_DIRS[projectType as ProjectType] ?? [];
}
