// Web 版独立 Vite 配置
//
// 功能概述:
// 为「喵创说」在线体验版提供独立的构建配置, 输出到 dist-web/ 目录,
// 部署到 GitHub Pages 根路径 (https://fanquanpp.github.io/MiaoChuangShuo/)。
// 复用项目根的 React/Tailwind/PostCSS 配置, 不引入新依赖。
//
// 模块职责:
// 1. 设置 base 路径以匹配 GitHub Pages 仓库根路径
// 2. 配置入口 HTML 与输出目录
// 3. 复用根项目的 Tailwind/PostCSS 配置
// 4. 第三方库分包策略, 提升浏览器缓存命中率
//
// 注意: 本文件不使用 Node 的 path/__dirname, 改用相对路径,
// 避免 @types/node 依赖。vite 命令在项目根执行, 相对路径基于 cwd 解析。
// 部署策略: 工作流将 dist-web/ 作为 Pages artifact 上传,
// 项目已停止维护, 原参赛报名展示页已下线。

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite 配置
// 输入: 无
// 输出: Vite 配置对象
// 流程:
//   1. 设置 base 路径为 GitHub Pages 仓库根路径 /MiaoChuangShuo/
//   2. 指定 web/ 作为构建根目录 (vite 自动查找 root/index.html)
//   3. 输出目录使用相对路径 ../dist-web (相对于 root)
//   4. 配置第三方库分包, 与桌面版保持一致策略
export default defineConfig({
  plugins: [react()],
  // GitHub Pages 仓库根路径, 必须以斜杠结尾
  // Web 版部署到 Pages 根目录, 访问地址为
  // https://fanquanpp.github.io/MiaoChuangShuo/
  base: "/MiaoChuangShuo/",
  // 构建根目录 (web/), vite 会自动查找该目录下的 index.html
  // 相对路径基于 cwd (vite 命令在项目根执行)
  root: "web",
  css: {
    // 复用根项目 PostCSS / Tailwind 配置 (相对 cwd 的路径)
    postcss: "./postcss.config.js",
  },
  build: {
    // 输出到项目根的 dist-web/ 目录 (相对 root 的路径)
    outDir: "../dist-web",
    // 输出目录已存在时清空, 避免残留旧资源
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 分包策略: 与桌面版保持一致, 提升浏览器缓存命中率
        // - react-vendor: React 核心 (react/react-dom)
        // - tiptap-vendor: TipTap 编辑器生态 (@tiptap/* 全部扩展)
        manualChunks: (id: string): string | undefined => {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("scheduler")) {
              return "react-vendor";
            }
            if (id.includes("@tiptap")) {
              return "tiptap-vendor";
            }
          }
          return undefined;
        },
      },
    },
  },
});
