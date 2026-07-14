//! 统一应用错误类型模块
//!
//! 提供全项目通用的 AppError 枚举，替代 Result<T, String> 的字符串错误类型，
//! 支持结构化错误信息传递到前端，便于前端根据错误类型进行差异化处理与 i18n 本地化。

use serde::Serialize;

/// 应用统一错误类型枚举
///
/// 覆盖 IO、序列化、路径校验、索引、AI 调用、配置六类错误场景，
/// 通过 serde::Serialize 输出 { kind, message, context } 结构供前端消费。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// IO 错误，包含底层 std::io::Error 与上下文描述
    #[error("IO 错误: {context}: {source}")]
    IoError {
        source: std::io::Error,
        context: String,
    },

    /// 序列化/反序列化错误，包含底层 serde_json::Error 与上下文描述
    #[error("序列化错误: {context}: {source}")]
    SerializeError {
        source: serde_json::Error,
        context: String,
    },

    /// 路径校验失败错误，如路径穿越攻击、路径不在项目根目录内等
    #[error("路径校验失败: {0}")]
    PathValidationError(String),

    /// Tantivy 索引错误，如索引打开失败、写入失败、查询失败等
    #[error("索引错误: {0}")]
    IndexError(String),

    /// AI 调用错误，如 API 请求失败、流式响应解析失败、配置缺失等
    #[error("AI 调用错误: {0}")]
    AiError(String),

    /// 配置错误，如配置文件读取失败、配置项缺失、配置格式错误等
    #[error("配置错误: {0}")]
    ConfigError(String),
}

/// 实现 From<std::io::Error> 转换，自动包装 IO 错误
///
/// 调用方使用 `?` 操作符时自动转换，需提供 context 参数
impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::IoError {
            source: error,
            context: "未指定上下文".to_string(),
        }
    }
}

/// 实现 From<serde_json::Error> 转换，自动包装序列化错误
///
/// 调用方使用 `?` 操作符时自动转换，需提供 context 参数
impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        AppError::SerializeError {
            source: error,
            context: "未指定上下文".to_string(),
        }
    }
}

/// 错误类型标识字符串，用于前端 i18n 映射
///
/// 前端通过此字段判断错误类型，映射到 i18n key（如 error.io_error）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
enum ErrorKind {
    IoError,
    SerializeError,
    PathValidationError,
    IndexError,
    AiError,
    ConfigError,
}

impl AppError {
    /// 获取错误类型标识
    ///
    /// 返回 ErrorKind 枚举，用于序列化到前端的 kind 字段
    fn kind(&self) -> ErrorKind {
        match self {
            AppError::IoError { .. } => ErrorKind::IoError,
            AppError::SerializeError { .. } => ErrorKind::SerializeError,
            AppError::PathValidationError(_) => ErrorKind::PathValidationError,
            AppError::IndexError(_) => ErrorKind::IndexError,
            AppError::AiError(_) => ErrorKind::AiError,
            AppError::ConfigError(_) => ErrorKind::ConfigError,
        }
    }

    /// 获取错误消息内容
    ///
    /// 返回错误的核心描述信息，用于序列化到前端的 message 字段
    fn message(&self) -> String {
        self.to_string()
    }

    /// 获取错误上下文
    ///
    /// 返回错误发生时的上下文描述，用于序列化到前端的 context 字段
    /// 对于无 context 的错误类型，返回空字符串
    fn context(&self) -> String {
        match self {
            AppError::IoError { context, .. } => context.clone(),
            AppError::SerializeError { context, .. } => context.clone(),
            _ => String::new(),
        }
    }
}

/// 实现 serde::Serialize，输出 { kind, message, context } 结构
///
/// 前端 invoke 捕获的错误对象将包含三个字段：
/// - kind: 错误类型标识（如 "ioError"），用于 i18n 映射
/// - message: 错误核心消息
/// - context: 错误上下文描述（可为空）
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;

        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("kind", &self.kind())?;
        state.serialize_field("message", &self.message())?;
        state.serialize_field("context", &self.context())?;
        state.end()
    }
}

/// 提供便捷构造方法
///
/// 为带 context 的错误类型提供 with_context 构造方法，
/// 便于调用方在 `?` 操作符无法满足时手动构造错误
impl AppError {
    /// 构造 IO 错误，附带上下文描述
    pub fn io_error(source: std::io::Error, context: impl Into<String>) -> Self {
        AppError::IoError {
            source,
            context: context.into(),
        }
    }

    /// 构造序列化错误，附带上下文描述
    pub fn serialize_error(source: serde_json::Error, context: impl Into<String>) -> Self {
        AppError::SerializeError {
            source,
            context: context.into(),
        }
    }

    /// 构造路径校验错误
    pub fn path_validation_error(message: impl Into<String>) -> Self {
        AppError::PathValidationError(message.into())
    }

    /// 构造索引错误
    pub fn index_error(message: impl Into<String>) -> Self {
        AppError::IndexError(message.into())
    }

    /// 构造 AI 调用错误
    pub fn ai_error(message: impl Into<String>) -> Self {
        AppError::AiError(message.into())
    }

    /// 构造配置错误
    pub fn config_error(message: impl Into<String>) -> Self {
        AppError::ConfigError(message.into())
    }
}
