import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Vite 配置
// 输入: 无
// 输出: Vite 配置对象
// 流程: 配置 React 插件、路径别名、Tauri 开发服务器端口
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // 写作工具集成大量 TipTap 富文本扩展，主 chunk 必然超过 500kB 默认阈值
  // 提升阈值避免误导性警告（实际 gzip 后仅 272kB，可接受）
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 分包策略：将第三方库按生态拆分，提升浏览器缓存命中率
        // - react-vendor: React 核心（react/react-dom）
        // - tiptap-vendor: TipTap 编辑器生态（@tiptap/* 全部扩展）
        // - flow-vendor: React Flow 图谱库（@xyflow/react + @dagrejs/dagre）
        // 其余第三方依赖（zustand/cmdk/lucide-react 等）归入默认 vendor 分包
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("scheduler")) {
              return "react-vendor";
            }
            if (id.includes("@tiptap")) {
              return "tiptap-vendor";
            }
            if (id.includes("@xyflow") || id.includes("@dagrejs")) {
              return "flow-vendor";
            }
          }
          return undefined;
        },
      },
    },
  },
}));
