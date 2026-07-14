// 统一日志服务
//
// 功能概述：
// 提供项目级统一日志输出，替代散落在各模块的 console.error/warn 调用。
// 支持日志级别配置（debug/info/warn/error），开发环境默认 debug+，生产环境默认 error+。
// 低于配置级别的方法为 no-op（空操作），不影响性能。
//
// 模块职责：
// 1. 提供 logger.debug/info/warn/error 四个日志方法
// 2. 支持运行时调整日志级别（setLogLevel）
// 3. 统一日志格式：[时间戳] [级别] [模块] 消息
// 4. 开发环境输出全部日志，生产环境仅输出 error 级别
//
// 设计说明：
// - 本模块为纯工具模块，除 console 输出外无副作用
// - 日志级别通过模块级变量管理，setLogLevel 可运行时调整
// - 生产环境（import.meta.env.DEV === false）默认 error 级别，debug/info 调用为 no-op
// - 不替换本模块内部的 console 调用（那是最终输出通道）

// ===== 类型定义 =====

/**
 * 日志级别枚举
 * - debug: 调试信息（最详细，仅开发环境输出）
 * - info: 一般信息
 * - warn: 警告信息
 * - error: 错误信息（始终输出）
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 日志上下文类型
 * 支持常见可日志化的值：基础类型、null、非原始对象（含 Error、普通对象、数组等）
 * catch 块中的 err（unknown 类型）需调用方先转换为 Error 或 string 后传入
 * 转换方式：err instanceof Error ? err : String(err)
 */
type LogContext = string | number | boolean | null | object;

// ===== 日志级别配置 =====

/** 日志级别权重（数值越大，级别越高，输出越少） */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 默认日志级别
 * 开发环境（import.meta.env.DEV === true）默认 debug，输出全部日志
 * 生产环境（import.meta.env.DEV === false）默认 error，仅输出错误
 */
const DEFAULT_LOG_LEVEL: LogLevel = import.meta.env.DEV ? "debug" : "error";

/** 当前生效的日志级别（模块级变量，通过 setLogLevel 调整） */
let currentLogLevel: LogLevel = DEFAULT_LOG_LEVEL;

// ===== 日志格式化 =====

/**
 * 格式化时间戳
 * 输入：无
 * 输出：ISO 8601 格式的时间字符串（如 2026-07-14T10:30:00.000Z）
 * 流程：使用 Date.toISOString 输出标准化时间戳，保证日志时序可追溯
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * 组装完整日志消息
 * 输入：
 *   level 日志级别
 *   message 日志消息正文
 *   module 模块标识（可选，用于标记日志来源模块）
 * 输出：格式化后的完整日志字符串 [时间戳] [级别] [模块] 消息
 * 流程：拼接时间戳、级别、模块标识与消息正文为统一格式
 */
function buildLogMessage(
  level: LogLevel,
  message: string,
  module: string | undefined
): string {
  const timestamp = formatTimestamp();
  const levelStr = level.toUpperCase();
  const moduleStr = module ? ` [${module}]` : "";
  return `[${timestamp}] [${levelStr}]${moduleStr} ${message}`;
}

// ===== 日志输出 =====

/**
 * 输出日志到控制台
 * 输入：
 *   level 日志级别
 *   message 日志消息正文
 *   context 附加上下文数据（可选，如 Error 对象或结构化数据）
 *   module 模块标识（可选）
 * 流程：
 *   1. 检查当前日志级别，低于配置级别则跳过（no-op）
 *   2. 组装完整日志消息
 *   3. 根据级别调用对应的 console 方法
 *   4. 上下文数据作为第二参数传递（便于 dev tools 展开查看对象详情）
 */
function outputLog(
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
  module: string | undefined
): void {
  // 级别过滤：低于配置级别则不输出（no-op）
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[currentLogLevel]) {
    return;
  }

  const fullMessage = buildLogMessage(level, message, module);

  // 根据级别调用对应的 console 方法，上下文作为附加参数传递
  // 保留 context 原始对象引用，便于浏览器 dev tools 展开查看
  switch (level) {
    case "debug":
      if (context !== undefined) {
        console.debug(fullMessage, context);
      } else {
        console.debug(fullMessage);
      }
      break;
    case "info":
      if (context !== undefined) {
        console.info(fullMessage, context);
      } else {
        console.info(fullMessage);
      }
      break;
    case "warn":
      if (context !== undefined) {
        console.warn(fullMessage, context);
      } else {
        console.warn(fullMessage);
      }
      break;
    case "error":
      if (context !== undefined) {
        console.error(fullMessage, context);
      } else {
        console.error(fullMessage);
      }
      break;
  }
}

// ===== Logger 接口定义 =====

/**
 * 统一日志接口
 * 每个方法接受 message（消息）和可选的 context（上下文）与 module（模块标识）参数
 */
interface Logger {
  /**
   * 输出 debug 级别日志
   * 输入：
   *   message 日志消息正文
   *   context 附加上下文数据（可选）
   *   module 模块标识（可选）
   */
  debug(message: string, context?: LogContext, module?: string): void;
  /**
   * 输出 info 级别日志
   * 输入：
   *   message 日志消息正文
   *   context 附加上下文数据（可选）
   *   module 模块标识（可选）
   */
  info(message: string, context?: LogContext, module?: string): void;
  /**
   * 输出 warn 级别日志
   * 输入：
   *   message 日志消息正文
   *   context 附加上下文数据（可选）
   *   module 模块标识（可选）
   */
  warn(message: string, context?: LogContext, module?: string): void;
  /**
   * 输出 error 级别日志
   * 输入：
   *   message 日志消息正文
   *   context 附加上下文数据（可选）
   *   module 模块标识（可选）
   */
  error(message: string, context?: LogContext, module?: string): void;
}

// ===== Logger 单例 =====

/**
 * 统一日志实例
 * 使用方式：
 *   import { logger } from "../lib/logger";
 *   logger.error("操作失败:", err instanceof Error ? err : String(err));
 *   logger.warn("配置缺失:", { key: "aiModel" }, "AiSettings");
 */
export const logger: Logger = {
  debug: (message, context, module) =>
    outputLog("debug", message, context, module),
  info: (message, context, module) =>
    outputLog("info", message, context, module),
  warn: (message, context, module) =>
    outputLog("warn", message, context, module),
  error: (message, context, module) =>
    outputLog("error", message, context, module),
};

// ===== 日志级别管理 =====

/**
 * 设置日志级别（运行时调整）
 * 输入：level 目标日志级别（debug/info/warn/error）
 * 输出：无
 * 流程：更新模块级变量 currentLogLevel，后续日志输出按新级别过滤
 * 使用场景：调试时临时提升日志级别，或生产环境降低日志输出量
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}
