// 全局搜索组件
//
// 功能概述：
// 在项目内全文搜索关键词，展示匹配结果列表，支持点击跳转到对应文件。
// 采用 FANDEX 直角美学与三色品牌体系。
//
// 模块职责：
// 1. 提供搜索输入框与选项
// 2. 调用后端搜索接口
// 3. 渲染搜索结果列表(含上下文高亮)
// 4. 支持点击结果跳转到文件编辑

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Search,
  Loader2,
  FileText,
  CaseSensitive,
  ChevronRight,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { searchInProject, type SearchResult } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function GlobalSearch() {
  const { currentProject, setActiveCategory, setSelectedFile } = useAppStore();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async () => {
    if (!currentProject || !query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const data = await searchInProject(currentProject.path, query.trim(), caseSensitive);
      setResults(data);
    } catch (e) {
      console.error("搜索失败:", e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [currentProject, query, caseSensitive]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        doSearch();
      } else {
        setResults([]);
        setSearched(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query, caseSensitive, doSearch]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleJumpToResult = (result: SearchResult) => {
    setSelectedFile({
      name: result.file_name,
      relative_path: result.relative_path,
      is_dir: false,
      children: [],
      size: 0,
    });
    setActiveCategory("manuscript");
  };

  const highlightKeyword = (text: string, keyword: string): React.ReactNode => {
    if (!keyword) return text;
    const searchKey = caseSensitive ? keyword : keyword.toLowerCase();
    const searchText = caseSensitive ? text : text.toLowerCase();
    const idx = searchText.indexOf(searchKey);
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + keyword.length);
    const after = text.slice(idx + keyword.length);
    return (
      <>
        {before}
        <mark className="bg-fandex-tertiary/30 text-fandex-tertiary px-0.5">
          {match}
        </mark>
        {after}
      </>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      <div className="px-6 py-4 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text mb-3">
          {t("search.title")}
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nf-text-tertiary" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search.placeholder")}
              className="w-full bg-nf-bg border border-nf-border-light pl-9 pr-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast"
            />
          </div>
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            title={caseSensitive ? t("search.caseSensitiveOn") : t("search.caseSensitiveOff")}
            className={`flex items-center justify-center w-9 h-9 border transition-fast ${
              caseSensitive
                ? "bg-fandex-tertiary/15 text-fandex-tertiary border-fandex-tertiary/40"
                : "text-nf-text-tertiary border-nf-border-light hover:text-nf-text hover:border-nf-text-tertiary"
            }`}
          >
            <CaseSensitive className="w-4 h-4" />
          </button>
        </div>
      </div>

      {searched && !loading && (
        <div className="px-6 py-2 border-b border-nf-border-light bg-nf-bg-sidebar text-xs text-nf-text-tertiary">
          {results.length > 0
            ? t("search.resultsMax", { count: results.length, suffix: results.length >= 200 ? t("search.resultsMaxHint") : "" })
            : t("search.noResults")}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-fandex-primary" />
          </div>
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
                className="fandex-bar-left bg-nf-bg-card border border-nf-border-light hover:border-fandex-primary/40 p-3 transition-fast cursor-pointer group"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0" />
                  <span className="text-xs font-medium font-display text-nf-text group-hover:text-fandex-primary transition-fast truncate">
                    {result.file_name}
                  </span>
                  <span className="text-[10px] text-nf-text-tertiary flex-shrink-0">
                    {t("search.lineNum", { num: result.line_number })}
                  </span>
                  <span className="text-[10px] text-nf-text-tertiary truncate">
                    {result.relative_path}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-nf-text-tertiary ml-auto group-hover:text-fandex-primary transition-fast flex-shrink-0" />
                </div>
                <div className="text-xs text-nf-text-secondary leading-relaxed font-mono pl-5">
                  {highlightKeyword(result.line_content.trim(), query.trim())}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
