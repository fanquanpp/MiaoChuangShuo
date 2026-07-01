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
  },
}));
