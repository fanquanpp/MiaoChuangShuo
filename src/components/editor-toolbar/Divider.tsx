// 工具栏分隔线组件
//
// 功能概述：
// 纯展示组件，用于在工具栏按钮分组之间插入视觉分隔。
// 单线紧凑记事本风格，无任何逻辑与状态。
//
// 模块职责：
// 仅渲染一条垂直分隔线，不接收业务 props。

/**
 * 分隔符 - 纯单线，紧凑记事本风格
 *
 * 输入参数: 无
 * 返回值: JSX 分隔线元素
 * 核心流程:
 *   直接渲染 1px 宽、20px 高的半透明竖线，左右各留 6px 间距。
 */
export function Divider() {
  return <div className="w-px h-5 bg-nf-border-light/50 mx-1.5" />;
}

export default Divider;
