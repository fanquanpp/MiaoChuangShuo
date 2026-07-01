// 新建文件向导组件（4 步式模块化模板选择）
//
// 功能概述：
// 替代原 CreateFileDialog 的硬编码流程，提供"模板选择 → 字段勾选 → 命名 → 预览"四步向导。
// 用户可自由勾选可选模块（Chip 交互），实时预览生成的分行排版文本。
// 后端通过 template_schema.rs 的 get_templates / render_template 命令提供模板数据。
//
// 模块职责：
// 1. 加载指定分类的模板列表（含空白模板选项）
// 2. 渲染模块化字段勾选面板（Chip 风格）
// 3. 文件名输入与校验
// 4. 实时预览生成的模板文本
// 5. 提交创建请求并回调父组件

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  FilePlus,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  FileText,
  Sparkles,
  Eye,
  AlertCircle,
} from "lucide-react";
import { isValidFileName } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import {
  getTemplates,
  renderTemplate,
  type TemplateSchema,
  type TemplateModule,
  type FieldDef,
} from "../lib/templateSchema";

// 翻译函数类型（与 i18n.tsx 中 TFunction 保持一致）
type TFunc = (key: string, params?: Record<string, string | number>) => string;

// 向导步骤枚举
type WizardStep = "template" | "fields" | "name" | "preview";

// 步骤顺序定义
const STEP_ORDER: WizardStep[] = ["template", "fields", "name", "preview"];

// 空白模板标识（非后端真实模板，用于走空白文件流程）
const BLANK_TEMPLATE_ID = "__blank__";

interface CreateFileWizardProps {
  // 是否显示
  open: boolean;
  // 目标目录名（用于标题展示）
  dirName: string;
  // 模板分类（character/worldview/glossary/outline）
  templateCategory: string;
  // 关闭回调
  onClose: () => void;
  // 创建确认回调：fileName 文件名, content 文件内容
  onConfirm: (fileName: string, content: string) => Promise<void>;
}

/**
 * 新建文件向导组件
 * 输入: props 包含 open/dirName/templateCategory/onClose/onConfirm
 * 输出: JSX 向导界面
 * 流程:
 *   1. 打开时加载指定分类的模板列表
 *   2. 用户选择模板（或空白）
 *   3. 选择模板后进入字段勾选步骤（Chip 风格）
 *   4. 命名文件
 *   5. 预览生成内容并确认创建
 */
export default function CreateFileWizard({
  open,
  dirName,
  templateCategory,
  onClose,
  onConfirm,
}: CreateFileWizardProps) {
  const { t } = useI18n();
  const { showToast } = useToast();

  // 当前步骤
  const [step, setStep] = useState<WizardStep>("template");
  // 模板列表
  const [templates, setTemplates] = useState<TemplateSchema[]>([]);
  // 选中的模板 ID
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  // 启用的模块 ID 列表
  const [enabledModuleIds, setEnabledModuleIds] = useState<string[]>([]);
  // 文件名
  const [fileName, setFileName] = useState("");
  // 文件名错误
  const [fileNameError, setFileNameError] = useState("");
  // 加载状态
  const [loading, setLoading] = useState(false);
  // 创建中状态
  const [creating, setCreating] = useState(false);
  // 预览内容
  const [previewContent, setPreviewContent] = useState("");

  // 打开时加载模板列表
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setStep("template");
    setSelectedTemplateId("");
    setEnabledModuleIds([]);
    setFileName("");
    setFileNameError("");
    setPreviewContent("");

    getTemplates(templateCategory)
      .then((list) => {
        setTemplates(list);
      })
      .catch((e: unknown) => {
        showToast("error", t("wizard.loadTemplateFailed", { error: String(e) }));
        setTemplates([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, templateCategory, showToast, t]);

  // 当前选中的模板对象
  const selectedTemplate = useMemo<TemplateSchema | null>(() => {
    if (!selectedTemplateId || selectedTemplateId === BLANK_TEMPLATE_ID) return null;
    return templates.find((tp) => tp.id === selectedTemplateId) ?? null;
  }, [selectedTemplateId, templates]);

  // 选择模板时初始化启用模块为默认模块
  const handleSelectTemplate = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);
    const tpl = templates.find((tp) => tp.id === templateId);
    setEnabledModuleIds(tpl ? [...tpl.default_enabled_modules] : []);
  }, [templates]);

  // 切换模块启用状态
  const toggleModule = useCallback((moduleId: string) => {
    setEnabledModuleIds((prev) =>
      prev.includes(moduleId)
        ? prev.filter((id) => id !== moduleId)
        : [...prev, moduleId]
    );
  }, []);

  // 校验文件名
  const validateFileName = useCallback((name: string): string => {
    const trimmed = name.trim();
    if (!trimmed) return "";
    if (!isValidFileName(trimmed)) return t("filelist.invalidChars");
    if (trimmed.includes(".")) {
      const ext = trimmed.split(".").pop()?.toLowerCase();
      if (ext !== "txt") return t("filelist.unsupportedExt");
    }
    return "";
  }, [t]);

  // 处理文件名输入
  const handleFileNameChange = useCallback((value: string) => {
    setFileName(value);
    setFileNameError("");
  }, []);

  // 当前步骤索引
  const stepIndex = STEP_ORDER.indexOf(step);

  // 上一步
  const handlePrev = useCallback(() => {
    if (stepIndex > 0) {
      setStep(STEP_ORDER[stepIndex - 1]);
    }
  }, [stepIndex]);

  // 下一步（含校验）
  const handleNext = useCallback(() => {
    if (step === "template") {
      if (!selectedTemplateId) {
        showToast("warning", t("wizard.selectTemplateFirst"));
        return;
      }
      // 空白模板直接跳到命名步骤
      if (selectedTemplateId === BLANK_TEMPLATE_ID) {
        setStep("name");
      } else {
        setStep("fields");
      }
      return;
    }
    if (step === "fields") {
      setStep("name");
      return;
    }
    if (step === "name") {
      const err = validateFileName(fileName);
      if (err) {
        setFileNameError(err);
        return;
      }
      // 进入预览步骤时生成内容
      if (selectedTemplateId === BLANK_TEMPLATE_ID) {
        setPreviewContent("");
        setStep("preview");
      } else {
        // 调用后端渲染
        const finalName = fileName.trim().endsWith(".txt")
          ? fileName.trim()
          : `${fileName.trim()}.txt`;
        renderTemplate(selectedTemplateId, enabledModuleIds, finalName)
          .then((content) => {
            setPreviewContent(content);
            setStep("preview");
          })
          .catch((e: unknown) => {
            showToast("error", t("wizard.renderFailed", { error: String(e) }));
          });
      }
    }
  }, [step, stepIndex, selectedTemplateId, fileName, enabledModuleIds, validateFileName, showToast, t]);

  // 完成创建
  const handleFinish = useCallback(async () => {
    const trimmedName = fileName.trim();
    if (!trimmedName) return;

    setCreating(true);
    try {
      let finalName = trimmedName;
      if (!finalName.endsWith(".txt")) {
        finalName += ".txt";
      }
      await onConfirm(finalName, previewContent);
      setFileName("");
      setPreviewContent("");
      onClose();
    } catch (e: unknown) {
      showToast("error", t("filelist.createFailed", { error: String(e) }));
    } finally {
      setCreating(false);
    }
  }, [fileName, previewContent, onConfirm, onClose, showToast, t]);

  if (!open) return null;

  // 步骤标题映射
  const stepTitleMap: Record<WizardStep, string> = {
    template: t("wizard.step.template"),
    fields: t("wizard.step.fields"),
    name: t("wizard.step.name"),
    preview: t("wizard.step.preview"),
  };

  // 是否可以下一步
  const canNext = step === "template"
    ? !!selectedTemplateId
    : step === "name"
    ? !!fileName.trim() && !fileNameError
    : true;

  // 是否显示字段步骤（空白模板跳过）
  const showFieldsStep = selectedTemplateId !== BLANK_TEMPLATE_ID;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !creating) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl h-[80vh] max-h-[680px] bg-nf-bg-card border border-nf-border-light shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：标题 + 步骤指示 + 关闭 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
          <div className="flex items-center gap-2">
            <FilePlus className="w-4 h-4 text-fandex-primary" />
            <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">
              {t("wizard.title")}
            </h3>
            <span className="text-xs text-nf-text-tertiary ml-2">
              {dirName}/
            </span>
          </div>
          <button
            onClick={() => !creating && onClose()}
            disabled={creating}
            className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 步骤进度条 */}
        <div className="px-5 py-2 border-b border-nf-border-light bg-nf-bg/40">
          <div className="flex items-center gap-1">
            {STEP_ORDER.filter((s) => showFieldsStep || s !== "fields").map((s, idx) => {
              const realIdx = STEP_ORDER.indexOf(s);
              const isActive = step === s;
              const isDone = stepIndex > realIdx;
              return (
                <div key={s} className="flex items-center flex-1">
                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 text-xs transition duration-fast ${
                      isActive
                        ? "text-fandex-primary"
                        : isDone
                        ? "text-fandex-secondary"
                        : "text-nf-text-tertiary"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-medium border transition duration-fast ${
                        isActive
                          ? "border-fandex-primary bg-fandex-primary/10"
                          : isDone
                          ? "border-fandex-secondary bg-fandex-secondary/10"
                          : "border-nf-border-light"
                      }`}
                    >
                      {isDone ? <Check className="w-3 h-3" /> : idx + 1}
                    </span>
                    <span>{stepTitleMap[s]}</span>
                  </div>
                  {idx < (showFieldsStep ? STEP_ORDER.length : STEP_ORDER.length - 1) - 1 && (
                    <div className="flex-1 h-px bg-nf-border-light mx-1" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="h-full flex items-center justify-center text-nf-text-tertiary">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <div
              key={step}
              className="h-full p-5"
            >
              {/* 步骤1：模板选择 */}
              {step === "template" && (
                <TemplateStep
                  templates={templates}
                  selectedId={selectedTemplateId}
                  onSelect={handleSelectTemplate}
                  t={t}
                />
              )}

              {/* 步骤2：字段勾选 */}
              {step === "fields" && selectedTemplate && (
                <FieldsStep
                  template={selectedTemplate}
                  enabledModuleIds={enabledModuleIds}
                  onToggleModule={toggleModule}
                  t={t}
                />
              )}

              {/* 步骤3：命名文件 */}
              {step === "name" && (
                <NameStep
                  fileName={fileName}
                  error={fileNameError}
                  onChange={handleFileNameChange}
                  placeholder={t("wizard.fileNamePlaceholder")}
                  label={t("wizard.fileNameLabel")}
                  autoMd={t("filelist.autoMd")}
                  t={t}
                />
              )}

              {/* 步骤4：预览 */}
              {step === "preview" && (
                <PreviewStep
                  content={previewContent}
                  isBlank={selectedTemplateId === BLANK_TEMPLATE_ID}
                  t={t}
                />
              )}
            </div>
          )}
        </div>

        {/* 底部：上一步 / 下一步 / 完成 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-nf-border-light bg-nf-bg/30">
          <div className="text-xs text-nf-text-tertiary">
            {step === "template" && templates.length === 0 && !loading
              ? t("wizard.noTemplate")
              : ""}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePrev}
              disabled={stepIndex === 0 || creating}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              {t("wizard.prev")}
            </button>
            {step !== "preview" ? (
              <button
                onClick={handleNext}
                disabled={!canNext || creating}
                className="flex items-center gap-1 px-3 py-1.5 bg-fandex-primary hover:bg-fandex-primary-hover text-sm font-medium text-nf-text-inverse transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("wizard.next")}
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={!fileName.trim() || creating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-fandex-secondary hover:bg-fandex-secondary/80 text-sm font-medium text-nf-bg-inverse transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                {creating ? t("app.creating") : t("wizard.finish")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 步骤1：模板选择子组件 =====

interface TemplateStepProps {
  templates: TemplateSchema[];
  selectedId: string;
  onSelect: (id: string) => void;
  t: TFunc;
}

function TemplateStep({ templates, selectedId, onSelect, t }: TemplateStepProps) {
  return (
    <div className="space-y-3">
      {/* 空白模板选项 */}
      <TemplateCard
        id={BLANK_TEMPLATE_ID}
        name={t("wizard.templateBlank")}
        description={t("wizard.templateBlankDesc")}
        icon="FileText"
        selected={selectedId === BLANK_TEMPLATE_ID}
        onClick={() => onSelect(BLANK_TEMPLATE_ID)}
      />

      {/* 预设模板列表 */}
      {templates.map((tp) => (
        <TemplateCard
          key={tp.id}
          id={tp.id}
          name={tp.name}
          description={tp.description}
          icon={tp.icon}
          moduleCount={tp.optional_modules.length}
          baseFieldCount={tp.base_fields.length}
          selected={selectedId === tp.id}
          onClick={() => onSelect(tp.id)}
        />
      ))}

      {templates.length === 0 && (
        <div className="text-center py-8 text-sm text-nf-text-tertiary">
          {t("wizard.noTemplate")}
        </div>
      )}
    </div>
  );
}

// 模板卡片
interface TemplateCardProps {
  id: string;
  name: string;
  description: string;
  icon: string;
  moduleCount?: number;
  baseFieldCount?: number;
  selected: boolean;
  onClick: () => void;
}

function TemplateCard({
  name,
  description,
  icon,
  moduleCount,
  baseFieldCount,
  selected,
  onClick,
}: TemplateCardProps) {
  const { t } = useI18n();
  // 图标映射：字符串名 → 组件（仅用常用几个）
  const IconComponent = icon === "Sparkles" ? Sparkles : icon === "Eye" ? Eye : FileText;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 border transition duration-fast group ${
        selected
          ? "border-fandex-primary bg-fandex-primary/5"
          : "border-nf-border-light hover:border-fandex-primary/40 hover:bg-nf-bg-hover"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 flex items-center justify-center flex-shrink-0 border transition duration-fast ${
            selected
              ? "border-fandex-primary text-fandex-primary bg-fandex-primary/10"
              : "border-nf-border-light text-nf-text-tertiary group-hover:text-nf-text-secondary"
          }`}
        >
          <IconComponent className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-nf-text">{name}</span>
            {selected && <Check className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0" />}
          </div>
          <p className="text-xs text-nf-text-secondary mt-0.5 line-clamp-2">{description}</p>
          {moduleCount !== undefined && baseFieldCount !== undefined && (
            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-nf-text-tertiary">
              <span>{t("wizard.fieldCount", { count: baseFieldCount })}</span>
              <span>·</span>
              <span>{t("wizard.moduleCount", { count: moduleCount })}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ===== 步骤2：字段勾选子组件 =====

interface FieldsStepProps {
  template: TemplateSchema;
  enabledModuleIds: string[];
  onToggleModule: (id: string) => void;
  t: TFunc;
}

function FieldsStep({ template, enabledModuleIds, onToggleModule, t }: FieldsStepProps) {
  return (
    <div className="space-y-4">
      {/* 基础字段展示（不可取消） */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-xs font-semibold text-nf-text uppercase tracking-wider">
            {t("wizard.baseFields")}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 bg-fandex-primary/10 text-fandex-primary rounded">
            {t("wizard.moduleRequired")}
          </span>
        </div>
        <div className="p-3 border border-nf-border-light bg-nf-bg/40">
          <div className="flex flex-wrap gap-1.5">
            {template.base_fields.map((field) => (
              <FieldChip key={field.key} field={field} required />
            ))}
          </div>
        </div>
      </div>

      {/* 可选模块勾选 */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-xs font-semibold text-nf-text uppercase tracking-wider">
            {t("wizard.optionalModules")}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 bg-fandex-secondary/10 text-fandex-secondary rounded">
            {t("wizard.moduleOptional")}
          </span>
          <span className="text-[10px] text-nf-text-tertiary ml-auto">
            {t("wizard.moduleCount", { count: template.optional_modules.length })}
          </span>
        </div>
        <div className="space-y-2">
          {template.optional_modules.map((module) => (
            <ModuleToggle
              key={module.id}
              module={module}
              enabled={enabledModuleIds.includes(module.id)}
              onToggle={() => onToggleModule(module.id)}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// 模块勾选卡片
interface ModuleToggleProps {
  module: TemplateModule;
  enabled: boolean;
  onToggle: () => void;
  t: TFunc;
}

function ModuleToggle({ module, enabled, onToggle, t }: ModuleToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left p-2.5 border transition duration-fast ${
        enabled
          ? "border-fandex-secondary bg-fandex-secondary/5"
          : "border-nf-border-light hover:border-fandex-secondary/30 hover:bg-nf-bg-hover"
      }`}
    >
      <div className="flex items-start gap-2">
        <div
          className={`w-4 h-4 mt-0.5 flex items-center justify-center border flex-shrink-0 transition duration-fast ${
            enabled
              ? "border-fandex-secondary bg-fandex-secondary text-nf-bg-inverse"
              : "border-nf-border-light"
          }`}
        >
          {enabled && <Check className="w-3 h-3" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-nf-text">{module.name}</span>
            <span className="text-[10px] text-nf-text-tertiary">
              {t("wizard.fieldCount", { count: module.fields.length })}
            </span>
          </div>
          {module.description && (
            <p className="text-xs text-nf-text-secondary mt-0.5">{module.description}</p>
          )}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {module.fields.map((field) => (
              <FieldChip key={field.key} field={field} compact />
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}

// 字段 Chip 标签
interface FieldChipProps {
  field: FieldDef;
  required?: boolean;
  compact?: boolean;
}

function FieldChip({ field, required, compact }: FieldChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 border text-[10px] transition duration-fast ${
        required
          ? "border-fandex-primary/30 bg-fandex-primary/5 text-fandex-primary"
          : "border-nf-border-light text-nf-text-secondary"
      } ${compact ? "px-1.5 py-0.5" : "px-2 py-1"}`}
    >
      {field.label}
      {field.required && !required && <span className="text-fandex-tertiary">*</span>}
    </span>
  );
}

// ===== 步骤3：命名文件子组件 =====

interface NameStepProps {
  fileName: string;
  error: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  autoMd: string;
  t: TFunc;
}

function NameStep({ fileName, error, onChange, placeholder, label, autoMd }: NameStepProps) {
  return (
    <div className="max-w-md mx-auto py-8">
      <label className="block text-xs text-nf-text-secondary mb-1.5">{label}</label>
      <input
        type="text"
        value={fileName}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus
        className="w-full bg-nf-bg border border-nf-border-light px-3 py-2.5 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
      />
      {error ? (
        <p className="flex items-center gap-1 text-xs text-red-400 mt-1.5">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      ) : (
        <p className="text-xs text-nf-text-tertiary mt-1.5">{autoMd}</p>
      )}
    </div>
  );
}

// ===== 步骤4：预览子组件 =====

interface PreviewStepProps {
  content: string;
  isBlank: boolean;
  t: TFunc;
}

function PreviewStep({ content, isBlank, t }: PreviewStepProps) {
  if (isBlank || !content) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-nf-text-tertiary gap-2">
        <FileText className="w-8 h-8 opacity-40" />
        <p className="text-sm">{t("wizard.previewEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 mb-2">
        <Eye className="w-3.5 h-3.5 text-fandex-primary" />
        <span className="text-xs font-semibold text-nf-text uppercase tracking-wider">
          {t("wizard.previewTitle")}
        </span>
      </div>
      <pre className="flex-1 overflow-auto p-3 bg-nf-bg border border-nf-border-light text-xs text-nf-text font-mono whitespace-pre-wrap break-all">
        {content}
      </pre>
    </div>
  );
}
