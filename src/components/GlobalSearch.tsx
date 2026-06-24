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

// 全局搜索组件
// 输入: 无
// 输出: 渲染搜索界面
// 流程:
//   1. 用户输入关键词
//   2. 防抖后调用后端搜索
//   3. 展示匹配结果
//   4. 点击结果跳转到文件
export default function GlobalSearch() {
  const { currentProject, setActiveCategory, setSelectedFile } = useAppStore();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 执行搜索
  // 输入: 无
  // 输出: 无
  // 流程: 调用 searchInProject 获取结果
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

  // 防抖搜索: 输入后 400ms 自动搜索
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

  // 组件挂载时聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 跳转到搜索结果
  // 输入: result 搜索结果项
  // 输出: 无
  // 流程: 选中文件并切换到正文分类
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

  // 高亮匹配关键词
  // 输入: text 原始文本, keyword 关键词
  // 输出: JSX 元素(含高亮)
  // 流程: 将匹配部分用 mark 标签包裹
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
      {/* 顶部搜索栏 - FANDEX 直角 */}
      <div className="px-6 py-4 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text mb-3">
          全局搜索
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nf-text-tertiary" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目内所有文件内容..."
              className="w-full bg-nf-bg border border-nf-border-light pl-9 pr-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast"
            />
          </div>
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            title={caseSensitive ? "区分大小写(已开启)" : "区分大小写(已关闭)"}
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

      {/* 搜索结果统计 */}
      {searched && !loading && (
        <div className="px-6 py-2 border-b border-nf-border-light bg-nf-bg-sidebar text-xs text-nf-text-tertiary">
          {results.length > 0
            ? `找到 ${results.length} 条匹配结果${results.length >= 200 ? "(仅显示前 200 条)" : ""}`
            : "未找到匹配结果"}
        </div>
      )}

      {/* 搜索结果列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-fandex-primary" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Search className="w-16 h-16 text-nf-border mb-4" />
            <p className="text-sm text-nf-text-tertiary">
              {searched ? "未找到匹配结果" : "输入关键词开始搜索"}
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
                {/* 文件信息行 */}
                <div className="flex items-center gap-2 mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0" />
                  <span className="text-xs font-medium font-display text-nf-text group-hover:text-fandex-primary transition-fast truncate">
                    {result.file_name}
                  </span>
                  <span className="text-[10px] text-nf-text-tertiary flex-shrink-0">
                    第 {result.line_number} 行
                  </span>
                  <span className="text-[10px] text-nf-text-tertiary truncate">
                    {result.relative_path}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-nf-text-tertiary ml-auto group-hover:text-fandex-primary transition-fast flex-shrink-0" />
                </div>
                {/* 匹配内容行 */}
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
