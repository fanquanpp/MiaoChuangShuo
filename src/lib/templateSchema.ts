// 模块化模板系统前端类型定义与 API 封装
//
// 功能概述：
// 定义与 Rust 后端 template_schema.rs 对应的 TypeScript 类型，
// 封装 Tauri invoke 调用，提供模板查询与渲染能力。
// 配合 CreateFileWizard 组件实现"基础字段 + 可选模块"的可组合新建流程。
//
// 模块职责：
// 1. 定义 FieldType / FieldDef / TemplateModule / TemplateSchema 类型
// 2. 封装 getTemplates / renderTemplate API
// 3. 提供 SidebarCategory 到模板 category 的映射
// 4. 提供模板字段渲染辅助工具

import { invoke } from "@tauri-apps/api/core";
import type { SidebarCategory } from "./store";

// ===== 字段类型枚举 =====
// 与后端 FieldType 一一对应，serde rename_all = "lowercase"
export type FieldType =
  | "text"
  | "richtext"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "boolean"
  | "url"
  | "reference";

// 字段定义接口
// 描述单个字段的元信息，用于前端动态渲染编辑器
export interface FieldDef {
  // 字段唯一标识（英文 key）
  key: string;
  // 字段显示名（中文）
  label: string;
  // 字段类型
  field_type: FieldType;
  // 是否必填
  required: boolean;
  // 占位提示文本
  placeholder?: string;
  // 默认值
  default?: string;
  // 单选/多选的选项列表
  options?: string[];
  // 帮助说明
  help_text?: string;
}

// 可选模块接口
// 一组相关字段的打包组合，用户可在新建文件时勾选启用
export interface TemplateModule {
  // 模块唯一标识
  id: string;
  // 模块显示名（如"角色弧光"）
  name: string;
  // 模块描述
  description: string;
  // 模块图标（lucide-react 图标名）
  icon: string;
  // 模块包含的字段列表
  fields: FieldDef[];
}

// 完整模板定义接口
// 由基础字段 + 可选模块组成
export interface TemplateSchema {
  // 模板唯一标识
  id: string;
  // 模板显示名
  name: string;
  // 模板所属分类（character/worldview/glossary/outline）
  category: string;
  // 模板描述
  description: string;
  // 模板图标
  icon: string;
  // 基础字段（强制启用）
  base_fields: FieldDef[];
  // 可选模块列表
  optional_modules: TemplateModule[];
  // 默认启用的模块 ID 列表
  default_enabled_modules: string[];
}

// ===== 分类到模板 category 的映射 =====
// SidebarCategory 与后端模板 category 的桥接
// 仅大纲支持模板化新建；设定类已统一收敛到 Codex（自有实体创建流程）
export const CATEGORY_TO_TEMPLATE: Partial<Record<SidebarCategory, string>> = {
  outline: "outline",
};

/**
 * 判断指定分类是否支持模块化模板新建
 * 输入: category 侧边栏分类
 * 输出: boolean 是否支持模板化
 */
export function isTemplateSupported(category: SidebarCategory): boolean {
  return category in CATEGORY_TO_TEMPLATE;
}

/**
 * 获取指定分类对应的模板 category
 * 输入: category 侧边栏分类
 * 输出: string | undefined 模板分类标识
 */
export function getTemplateCategory(category: SidebarCategory): string | undefined {
  return CATEGORY_TO_TEMPLATE[category];
}

// ===== API 封装 =====

/**
 * 获取指定分类的模板列表
 * 输入: category 模板分类（character/worldview/glossary/outline）
 * 输出: Promise<TemplateSchema[]> 模板列表
 * 流程: 调用后端 get_templates 命令
 */
export async function getTemplates(category: string): Promise<TemplateSchema[]> {
  return invoke<TemplateSchema[]>("get_templates", { category });
}

/**
 * 渲染指定模板为文本内容
 * 输入:
 *   templateId 模板 ID
 *   enabledModuleIds 用户启用的模块 ID 列表
 *   fileName 文件名（用于标题）
 * 输出: Promise<string> 渲染后的模板文本
 * 流程: 调用后端 render_template 命令，按勾选模块生成分行排版的文本
 */
export async function renderTemplate(
  templateId: string,
  enabledModuleIds: string[],
  fileName: string
): Promise<string> {
  return invoke<string>("render_template", {
    templateId,
    enabledModuleIds,
    fileName,
  });
}

// ===== 自定义文件模板 API（去硬编码：支持用户从文件系统加载/保存/删除模板）=====

/**
 * 保存自定义文件模板到文件系统
 * 输入: template 完整的模板结构体
 * 输出: Promise<string> 保存成功后的模板 ID（自动添加 custom- 前缀）
 * 流程: 调用后端 save_custom_file_template 命令，序列化为 JSON 写入 ~/.novelforge/templates/
 */
export async function saveCustomFileTemplate(template: TemplateSchema): Promise<string> {
  return invoke<string>("save_custom_file_template", { template });
}

/**
 * 删除自定义文件模板
 * 输入: templateId 模板 ID（必须以 custom- 开头）
 * 输出: Promise<string> 被删除的模板 ID
 * 流程: 调用后端 delete_custom_file_template 命令，删除对应的 JSON 文件
 */
export async function deleteCustomFileTemplate(templateId: string): Promise<string> {
  return invoke<string>("delete_custom_file_template", { templateId });
}

/**
 * 获取所有自定义文件模板列表
 * 输入: 无
 * 输出: Promise<TemplateSchema[]> 自定义模板列表
 * 流程: 调用后端 list_custom_file_templates 命令，从 ~/.novelforge/templates/ 加载
 */
export async function listCustomFileTemplates(): Promise<TemplateSchema[]> {
  return invoke<TemplateSchema[]>("list_custom_file_templates");
}

/**
 * 判断模板是否为自定义模板
 * 输入: templateId 模板 ID
 * 输出: boolean 是否为自定义模板（以 custom- 前缀标识）
 */
export function isCustomTemplate(templateId: string): boolean {
  return templateId.startsWith("custom-");
}

// ===== 字段渲染辅助工具 =====

/**
 * 判断字段是否为多行文本类型
 * 输入: field 字段定义
 * 输出: boolean 是否需要多行编辑器
 */
export function isMultilineField(field: FieldDef): boolean {
  return field.field_type === "richtext";
}

/**
 * 判断字段是否为选择类型（单选或多选）
 * 输入: field 字段定义
 * 输出: boolean 是否需要选择器
 */
export function isSelectField(field: FieldDef): boolean {
  return field.field_type === "select" || field.field_type === "multiselect";
}

/**
 * 获取字段在模块中的位置索引
 * 输入: template 模板定义, module 模块, fieldKey 字段 key
 * 输出: number 字段在模块中的位置（0-based），未找到返回 -1
 */
export function getFieldIndex(
  template: TemplateSchema,
  module: TemplateModule,
  fieldKey: string
): number {
  // 基础字段优先
  const baseIdx = template.base_fields.findIndex((f) => f.key === fieldKey);
  if (baseIdx >= 0) return baseIdx;
  // 模块字段
  return module.fields.findIndex((f) => f.key === fieldKey);
}
