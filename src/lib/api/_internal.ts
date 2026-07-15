// 喵创说 API 内部共享工具
//
// 模块职责：
// 提供跨 API 模块共享的内部工具函数，不对外暴露业务能力。
// 仅被 api/ 目录下的其他模块引用，组件层不应直接导入本文件。
//
// 设计说明：
// validatePathInProject 为纯函数（无副作用），符合工具函数约束，
// 但因与 API 调用强相关（路径沙箱校验），故置于 api/_internal.ts 而非 utils。
// extractErrorMessage 用于统一处理后端 AppError 序列化后的 {kind, message, context} 结构，
// 避免 catch 块中 String(e) 在对象上产出 "[object Object]" 的兼容性问题。

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

/**
 * 后端 AppError 序列化后的错误对象结构
 * 对应 src-tauri/src/error.rs 中 AppError 的 Serialize 输出
 */
interface AppErrorPayload {
  kind: string;
  message: string;
  context?: string;
}

/**
 * 从未知类型的错误对象中提取可读错误消息
 *
 * 统一处理后端 invoke 抛出的错误，兼容以下形态：
 *   1. Error 实例 → 返回 err.message
 *   2. 字符串 → 原样返回
 *   3. AppError 序列化对象 {kind, message, context} → 返回 message 字段
 *   4. 其他对象 → 降级为 JSON 字符串，避免 "[object Object]"
 *
 * 输入: e 任意 catch 块捕获的未知错误
 * 输出: 可读的错误消息字符串
 */
export function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === 'string') {
    return e;
  }
  if (e !== null && typeof e === 'object') {
    const payload = e as Partial<AppErrorPayload>;
    if (typeof payload.message === 'string' && typeof payload.kind === 'string') {
      return payload.message;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
