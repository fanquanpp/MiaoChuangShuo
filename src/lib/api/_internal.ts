// 喵创说 API 内部共享工具
//
// 模块职责：
// 提供跨 API 模块共享的内部工具函数，不对外暴露业务能力。
// 仅被 api/ 目录下的其他模块引用，组件层不应直接导入本文件。
//
// 设计说明：
// validatePathInProject 为纯函数（无副作用），符合工具函数约束，
// 但因与 API 调用强相关（路径沙箱校验），故置于 api/_internal.ts 而非 utils。

/**
 * 路径安全校验：确保文件路径在项目目录内
 * 防止目录遍历攻击的前端防护层（后端 Rust 也有校验）
 *
 * 输入: filePath 文件绝对路径, projectPath 项目根路径
 * 输出: 无返回值，校验失败时抛出异常
 * 流程: 统一将分隔符转为正斜杠后比较前缀，不在项目目录内则抛错
 */
export function validatePathInProject(filePath: string, projectPath: string): void {
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedProject = projectPath.replace(/\\/g, '/');
  if (!normalizedFile.startsWith(normalizedProject)) {
    throw new Error(`路径越界: 文件路径不在项目目录内`);
  }
}
