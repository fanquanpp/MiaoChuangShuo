import React from "react";
import Launcher from "./components/Launcher";

// 根组件 - FANDEX 暗黑主题
// 输入: 无
// 输出: 渲染 Launcher 启动器界面
// 流程: 包裹在 FANDEX 暗黑主题容器中渲染 Launcher 组件
function App() {
  return (
    <div className="antialiased text-nf-text bg-nf-bg min-h-screen">
      <Launcher />
    </div>
  );
}

export default App;
