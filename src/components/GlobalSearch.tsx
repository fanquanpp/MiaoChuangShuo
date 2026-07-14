// 全局搜索与替换组件
//
// 功能概述：
// 在项目内全文搜索关键词，展示匹配结果列表，支持点击跳转到对应文件。
// 支持替换模式：在项目内所有 .txt 文件中批量执行查找替换。
// 采用 FANDEX 直角美学与三色品牌体系。
//
// 模块职责：
// 1. 提供搜索输入框与选项（区分大小写）
// 2. 支持切换搜索/替换双模式
// 3. 调用后端搜索接口（搜索模式）
// 4. 调用后端替换接口（替换模式，带二次确认）
// 5. 渲染搜索结果列表（含上下文高亮）
// 6. 替换完成后刷新项目树并展示统计结果
// 7. 支持点击结果跳转到文件编辑

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Search,
  Loader2,
  FileText,
  CaseSensitive,
  ChevronRight,
  Replace as ReplaceIcon,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Database,
  Zap,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import {
  searchInProject,
  replaceInProject,
  searchProject,
  buildProjectIndex,
  type SearchResult,
  type ReplaceResult,
  type TantivySearchResult,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { logger } from "../lib/logger";
import { useToast } from "../lib/toast";

/**
 * 从相对路径推断分类
 * 输入: relativePath 文件相对路径
 * 输出: SidebarCategory 分类字符串
 * 流程:
 *   1. 提取路径首段目录名
 *   2. 优先匹配 4 个标准目录（正文/设定/大纲/草稿箱）
 *   3. 降级匹配设定库兼容目录名（与 CODEX_TYPE_DIRS 对齐）
 *   4. 默认归入正文类
 */
function detectCategoryFromPath(relativePath: string): string {
  const firstDir = relativePath.split(/[\\/]/)[0] || "";
  // 4 个标准一级目录映射（统一目录结构）
  const standardMap: Record<string, string> = {
    "正文": "manuscript",
    "设定": "codex",
    "大纲": "outline",
    "草稿箱": "manuscript",
  };
  // 设定库兼容目录映射（与 CODEX_TYPE_DIRS 对齐，用于识别散落的设定子目录）
  const codexDirMap: Record<string, string> = {
    "草稿": "manuscript",
    "角色": "codex",
    "人物": "codex",
    "世界观": "codex",
    "术语": "codex",
    "名词": "codex",
    "素材": "codex",
    "资料": "codex",
    "时间线": "codex",
  };
  return standardMap[firstDir] || codexDirMap[firstDir] || "manuscript";
}

export default function GlobalSearch() {
  const currentProject = useAppStore((s) => s.currentProject);
  const navigateToFile = useAppStore((s) => s.navigateToFile);
  const setPendingScrollLine = useAppStore((s) => s.setPendingScrollLine);
  const refreshProjectTree = useAppStore((s) => s.refreshProjectTree);
  const { t } = useI18n();
  const { showToast } = useToast();

  // 模式：search=仅搜索, replace=搜索+替换
  const [mode, setMode] = useState<"search" | "replace">("search");
  // 搜索后端模式：exact=精确匹配（按行扫描）, semantic=语义搜索（Tantivy 索引）
  // 语义搜索模式仅支持 search 模式，replace 模式强制使用 exact
  const [searchBackend, setSearchBackend] = useState<"exact" | "semantic">("exact");
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  // 精确匹配结果（旧 API）
  const [results, setResults] = useState<SearchResult[]>([]);
  // 语义搜索结果（Tantivy API）
  const [semanticResults, setSemanticResults] = useState<TantivySearchResult[]>([]);
  // 语义搜索时索引是否未构建（用于显示"构建索引"按钮）
  const [semanticIndexEmpty, setSemanticIndexEmpty] = useState(false);
  // 索引构建中状态（用于"构建索引"按钮 loading）
  const [buildingIndex, setBuildingIndex] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // 替换相关状态
  const [replacing, setReplacing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [replaceResult, setReplaceResult] = useState<ReplaceResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 执行搜索
   * 流程:
   *   - exact 模式: 调用 searchInProject 按行扫描，支持大小写区分
   *   - semantic 模式: 调用 searchProject 走 Tantivy 索引，返回 Chunk 列表
   *   - 语义搜索返回 0 结果且 index_stats.doc_count === 0 时，标记索引未构建
   */
  const doSearch = useCallback(async () => {
    if (!currentProject || !query.trim()) {
      setResults([]);
      setSemanticResults([]);
      setSemanticIndexEmpty(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      if (searchBackend === "semantic") {
        // 语义搜索：调用 Tantivy 后端
        const resp = await searchProject({
          project_path: currentProject.path,
          query: query.trim(),
          limit: 100,
        });
        setSemanticResults(resp.results);
        setResults([]);
        // 判断索引是否未构建（doc_count 为 0 视为未构建）
        setSemanticIndexEmpty(
          resp.results.length === 0 &&
          !!resp.index_stats &&
          resp.index_stats.doc_count === 0
        );
      } else {
        // 精确匹配：调用旧后端按行扫描
        const data = await searchInProject(currentProject.path, query.trim(), caseSensitive);
        setResults(data);
        setSemanticResults([]);
        setSemanticIndexEmpty(false);
      }
    } catch (e) {
      logger.error("搜索失败:", e instanceof Error ? e : String(e));
      showToast("error", t("search.failed"));
      setResults([]);
      setSemanticResults([]);
      setSemanticIndexEmpty(false);
    } finally {
      setLoading(false);
    }
  }, [currentProject, query, caseSensitive, searchBackend, showToast, t]);

  // 输入防抖：400ms 后自动搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        doSearch();
      } else {
        setResults([]);
        setSemanticResults([]);
        setSemanticIndexEmpty(false);
        setSearched(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query, caseSensitive, searchBackend, doSearch]);

  // 挂载时自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * 打开替换确认对话框
   * 流程: 校验输入，弹出二次确认
   */
  const handleReplaceClick = useCallback(() => {
    if (!query.trim()) {
      showToast("error", t("search.replaceEmptyError"));
      return;
    }
    if (query === replacement) {
      showToast("error", t("search.replaceSameError"));
      return;
    }
    setReplaceResult(null);
    setConfirmOpen(true);
  }, [query, replacement, showToast, t]);

  /**
   * 执行全局替换
   * 流程: 调用后端 replaceInProject，成功后刷新项目树并展示统计
   */
  const handleConfirmReplace = useCallback(async () => {
    if (!currentProject) return;
    setConfirmOpen(false);
    setReplacing(true);
    try {
      const result = await replaceInProject(
        currentProject.path,
        query,
        replacement,
        caseSensitive
      );
      setReplaceResult(result);
      showToast(
        "success",
        t("search.replaceSuccess", {
          files: result.files_modified,
          count: result.total_replacements,
        })
      );
      // 替换后刷新项目树与搜索结果
      await refreshProjectTree?.();
      await doSearch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("error", t("search.replaceFailed") + ": " + msg);
    } finally {
      setReplacing(false);
    }
  }, [currentProject, query, replacement, caseSensitive, showToast, t, refreshProjectTree, doSearch]);

  /**
   * 跳转到搜索结果对应文件
   * 输入: result 搜索结果项
   * 流程: 设置待定位行号，导航到对应分类与文件，编辑器加载后自动滚动到匹配行
   */
  const handleJumpToResult = (result: SearchResult) => {
    const category = detectCategoryFromPath(result.relative_path);
    // 设置待定位行号，NovelEditor 加载文件后消费并自动滚动
    setPendingScrollLine(result.line_number);
    navigateToFile(
      {
        name: result.file_name,
        relative_path: result.relative_path,
        is_dir: false,
        children: [],
        size: 0,
      },
      category as never
    );
  };

  /**
   * 跳转到语义搜索结果对应文件
   * 输入: result Tantivy 搜索结果项（含 file_path/file_name/text）
   * 流程: 语义搜索无行号信息，仅导航到文件，不设置滚动行号
   */
  const handleJumpToSemanticResult = (result: TantivySearchResult) => {
    const category = detectCategoryFromPath(result.file_path);
    navigateToFile(
      {
        name: result.file_name,
        relative_path: result.file_path,
        is_dir: false,
        children: [],
        size: 0,
      },
      category as never
    );
  };

  /**
   * 构建全文索引（语义搜索空索引时触发）
   * 流程:
   *   1. 调用 buildProjectIndex 全量构建索引
   *   2. 构建完成后重新执行搜索
   *   3. 失败时 toast 提示
   */
  const handleBuildIndex = useCallback(async () => {
    if (!currentProject || buildingIndex) return;
    setBuildingIndex(true);
    try {
      await buildProjectIndex(currentProject.path);
      showToast("success", t("index.buildSuccess", { docs: 0, files: 0 }));
      // 构建完成后重新搜索
      await doSearch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", `${t("search.failed")}: ${msg}`);
    } finally {
      setBuildingIndex(false);
    }
  }, [currentProject, buildingIndex, showToast, t, doSearch]);

  /**
   * 关键词高亮（安全：React JSX 自动转义，高亮所有匹配项）
   * 输入: text 原文, keyword 关键词
   * 输出: ReactNode 带高亮标记的节点
   */
  const highlightKeyword = useCallback(
    (text: string, keyword: string): React.ReactNode => {
      if (!keyword) return text;
      const parts: React.ReactNode[] = [];
      const searchKey = caseSensitive ? keyword : keyword.toLowerCase();
      let remaining = text;
      let keyIdx = 0;

      while (remaining.length > 0) {
        const searchText = caseSensitive ? remaining : remaining.toLowerCase();
        const idx = searchText.indexOf(searchKey);
        if (idx === -1) {
          parts.push(<span key={keyIdx++}>{remaining}</span>);
          break;
        }
        // 匹配前文本
        if (idx > 0) {
          parts.push(<span key={keyIdx++}>{remaining.slice(0, idx)}</span>);
        }
        // 高亮匹配部分
        parts.push(
          <mark
            key={keyIdx++}
            className="bg-fandex-tertiary/30 text-fandex-tertiary px-0.5"
          >
            {remaining.slice(idx, idx + keyword.length)}
          </mark>
        );
        remaining = remaining.slice(idx + keyword.length);
      }

      return <>{parts}</>;
    },
    [caseSensitive]
  );

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      {/* 头部：标题 + 模式切换 */}
      <div className="px-6 py-4 border-b border-nf-border-light">
        <div className="flex items-center justify-between mb-3">
          <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text">
            {mode === "replace" ? t("search.replaceTitle") : t("search.title")}
          </h2>
          {/* 模式切换按钮 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card border border-nf-border-light p-0.5">
            <button
              onClick={() => setMode("search")}
              title={t("search.searchMode")}
              className={`flex items-center gap-1 px-2 py-1 text-xs transition duration-fast ${
                mode === "search"
                  ? "bg-fandex-primary/15 text-fandex-primary"
                  : "text-nf-text-tertiary hover:text-nf-text"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              {t("search.searchMode")}
            </button>
            <button
              onClick={() => {
                // 替换模式仅支持精确匹配后端，切换时强制回退
                setMode("replace");
                setSearchBackend("exact");
              }}
              title={t("search.replaceMode")}
              className={`flex items-center gap-1 px-2 py-1 text-xs transition duration-fast ${
                mode === "replace"
                  ? "bg-fandex-tertiary/15 text-fandex-tertiary"
                  : "text-nf-text-tertiary hover:text-nf-text"
              }`}
            >
              <ReplaceIcon className="w-3.5 h-3.5" />
              {t("search.replaceMode")}
            </button>
          </div>
        </div>

        {/* 查找输入行 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nf-text-tertiary" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search.placeholder")}
              className="w-full bg-nf-bg border border-nf-border-light pl-9 pr-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
            />
          </div>
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            title={caseSensitive ? t("search.caseSensitiveOn") : t("search.caseSensitiveOff")}
            className={`flex items-center justify-center w-9 h-9 border transition duration-fast ${
              caseSensitive
                ? "bg-fandex-tertiary/15 text-fandex-tertiary border-fandex-tertiary/40"
                : "text-nf-text-tertiary border-nf-border-light hover:text-nf-text hover:border-nf-text-tertiary"
            }`}
          >
            <CaseSensitive className="w-4 h-4" />
          </button>
        </div>

        {/* 搜索后端切换：精确匹配 / 语义搜索
            仅 search 模式显示，replace 模式强制精确匹配（替换需行级定位） */}
        {mode === "search" && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-0.5 bg-nf-bg-card border border-nf-border-light p-0.5">
              <button
                onClick={() => setSearchBackend("exact")}
                title={t("index.modeExactHint")}
                className={`flex items-center gap-1 px-2 py-1 text-xs transition duration-fast ${
                  searchBackend === "exact"
                    ? "bg-fandex-primary/15 text-fandex-primary"
                    : "text-nf-text-tertiary hover:text-nf-text"
                }`}
              >
                <Search className="w-3 h-3" />
                {t("index.modeExact")}
              </button>
              <button
                onClick={() => setSearchBackend("semantic")}
                title={t("index.modeSemanticHint")}
                className={`flex items-center gap-1 px-2 py-1 text-xs transition duration-fast ${
                  searchBackend === "semantic"
                    ? "bg-fandex-secondary/15 text-fandex-secondary"
                    : "text-nf-text-tertiary hover:text-nf-text"
                }`}
              >
                <Zap className="w-3 h-3" />
                {t("index.modeSemantic")}
              </button>
            </div>
            <span className="text-[10px] text-nf-text-tertiary">
              {searchBackend === "exact" ? t("index.modeExactHint") : t("index.modeSemanticHint")}
            </span>
          </div>
        )}

        {/* 替换输入行（仅替换模式显示） */}
        {mode === "replace" && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 relative">
              <ReplaceIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fandex-tertiary" />
              <input
                type="text"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder={t("search.replacePlaceholder")}
                className="w-full bg-nf-bg border border-nf-border-light pl-9 pr-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-tertiary/60 transition duration-fast"
              />
            </div>
            <button
              onClick={handleReplaceClick}
              disabled={replacing || !query.trim() || query === replacement}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-nf-text-inverse bg-fandex-tertiary hover:bg-fandex-tertiary/90 disabled:opacity-40 disabled:cursor-not-allowed transition duration-fast"
            >
              {replacing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ReplaceIcon className="w-4 h-4" />
              )}
              {replacing ? t("search.replacing") : t("search.replaceBtn")}
            </button>
          </div>
        )}
      </div>

      {/* 替换结果统计条 */}
      {replaceResult && (
        <div className="px-6 py-2 border-b border-nf-border-light bg-fandex-secondary/5 flex items-center gap-2 text-xs">
          <CheckCircle2 className="w-4 h-4 text-fandex-secondary flex-shrink-0" />
          <span className="text-nf-text-secondary">
            {t("search.replaceSuccess", {
              files: replaceResult.files_modified,
              count: replaceResult.total_replacements,
            })}
          </span>
        </div>
      )}

      {/* 搜索结果统计条 */}
      {searched && !loading && mode === "search" && (
        <div className="px-6 py-2 border-b border-nf-border-light bg-nf-bg-sidebar text-xs text-nf-text-tertiary">
          {searchBackend === "semantic"
            ? semanticResults.length > 0
              ? t("search.results", { count: semanticResults.length })
              : t("index.semanticEmpty")
            : results.length > 0
              ? `${t("search.results", { count: results.length })}${results.length >= 200 ? ` ${t("search.resultsMaxHint")}` : ""}`
              : t("search.noResults")}
        </div>
      )}

      {/* 结果列表区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading || replacing ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-fandex-primary" />
          </div>
        ) : searchBackend === "semantic" && mode === "search" ? (
          // 语义搜索结果渲染
          semanticIndexEmpty ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Database className="w-16 h-16 text-nf-border mb-4" />
              <p className="text-sm text-nf-text-tertiary mb-4">
                {t("index.indexRequired")}
              </p>
              <button
                onClick={handleBuildIndex}
                disabled={buildingIndex}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-nf-text-inverse bg-fandex-secondary hover:bg-fandex-secondary/90 disabled:opacity-40 disabled:cursor-not-allowed transition duration-fast"
              >
                {buildingIndex ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Database className="w-4 h-4" />
                )}
                {buildingIndex ? t("index.building") : t("index.buildFirst")}
              </button>
            </div>
          ) : semanticResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Search className="w-16 h-16 text-nf-border mb-4" />
              <p className="text-sm text-nf-text-tertiary">
                {searched ? t("index.semanticEmpty") : t("search.hint")}
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-1">
              {semanticResults.map((result, idx) => (
                <div
                  key={`${result.file_path}-${result.chunk_index}-${idx}`}
                  onClick={() => handleJumpToSemanticResult(result)}
                  className="fandex-bar-left bg-nf-bg-card border border-nf-border-light hover:border-fandex-secondary/40 p-3 transition duration-fast cursor-pointer group"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <FileText className="w-3.5 h-3.5 text-fandex-secondary flex-shrink-0" />
                    <span className="text-xs font-medium font-display text-nf-text group-hover:text-fandex-secondary transition duration-fast truncate">
                      {result.file_name}
                    </span>
                    <span className="text-[10px] text-nf-text-tertiary truncate">
                      {result.file_path}
                    </span>
                    <span className="text-[10px] text-nf-text-tertiary flex-shrink-0">
                      #{result.chunk_index + 1}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-nf-text-tertiary ml-auto group-hover:text-fandex-secondary transition duration-fast flex-shrink-0" />
                  </div>
                  <div className="text-xs text-nf-text-secondary leading-relaxed pl-5 line-clamp-3">
                    {highlightKeyword(result.text.trim(), query.trim())}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Search className="w-16 h-16 text-nf-border mb-4" />
            <p className="text-sm text-nf-text-tertiary">
              {searched ? t("search.noResults") : t("search.hint")}
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-1">
            {results.map((result, idx) => (
              <div
                key={`${result.relative_path}-${result.line_number}-${idx}`}
                onClick={() => handleJumpToResult(result)}
                className="fandex-bar-left bg-nf-bg-card border border-nf-border-light hover:border-fandex-primary/40 p-3 transition duration-fast cursor-pointer group"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0" />
                  <span className="text-xs font-medium font-display text-nf-text group-hover:text-fandex-primary transition duration-fast truncate">
                    {result.file_name}
                  </span>
                  <span className="text-[10px] text-nf-text-tertiary flex-shrink-0">
                    {t("search.lineNum", { line: result.line_number })}
                  </span>
                  <span className="text-[10px] text-nf-text-tertiary truncate">
                    {result.relative_path}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-nf-text-tertiary ml-auto group-hover:text-fandex-primary transition duration-fast flex-shrink-0" />
                </div>
                <div className="text-xs text-nf-text-secondary leading-relaxed font-mono pl-5">
                  {highlightKeyword(result.line_content.trim(), query.trim())}
                </div>
                {/* 替换模式下展示替换预览 */}
                {mode === "replace" && replacement !== query && (
                  <div className="mt-1.5 pl-5 flex items-center gap-2 text-xs">
                    <ArrowRight className="w-3 h-3 text-fandex-tertiary flex-shrink-0" />
                    <span className="text-nf-text-tertiary line-through">
                      {highlightKeyword(result.line_content.trim(), query.trim())}
                    </span>
                    <ArrowRight className="w-3 h-3 text-fandex-secondary flex-shrink-0" />
                    <span className="text-fandex-secondary">
                      {result.line_content.replace(
                        new RegExp(
                          caseSensitive ? query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                          caseSensitive ? "g" : "gi"
                        ),
                        replacement
                      ).trim()}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 替换确认对话框 */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="nf-glass-panel w-full max-w-md bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-nf-border-light flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-fandex-tertiary flex-shrink-0" />
              <h3 className="text-sm font-semibold font-display text-nf-text">
                {t("search.replaceConfirm")}
              </h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-nf-text-secondary leading-relaxed">
                {t("search.replaceConfirmDesc")}
              </p>
              <div className="bg-nf-bg border border-nf-border-light p-3 space-y-1.5 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-nf-text-tertiary w-12 flex-shrink-0">{t("search.findLabel")}</span>
                  <span className="text-fandex-tertiary break-all">{query}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-nf-text-tertiary w-12 flex-shrink-0">{t("search.replaceLabel")}</span>
                  <span className="text-fandex-secondary break-all">{replacement}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("search.replaceCancel")}
              </button>
              <button
                onClick={handleConfirmReplace}
                className="px-3 py-1.5 text-sm font-medium text-nf-text-inverse bg-fandex-tertiary hover:bg-fandex-tertiary/90 transition duration-fast"
              >
                {t("search.replaceConfirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
