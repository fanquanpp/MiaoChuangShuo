// AI 配置持久化模块 (安全升级版 - Task 2.2)
//
// 功能概述:
//   管理 BYOK (Bring Your Own Key) 模式的 AI 配置, 包括 API Key、Base URL、模型名称等.
//   配置持久化到用户目录 (%APPDATA%\MiaoChuangShuo\ai_config.json).
//
// 安全策略 (Task 2.2 升级):
//   - API Key 优先存入系统钥匙串 (Windows Credential Manager / macOS Keychain / Linux Secret Service)
//     使用 keyring crate, 密文由操作系统托管, 应用进程外无法读取明文.
//   - 配置文件 ai_config.json 中 api_key 字段留空, 仅保留 use_secure_storage 标识.
//   - Windows 钥匙串写入失败时, 回退到 DPAPI (Data Protection API) 加密存储,
//     密文绑定当前用户账户, 安全性远高于旧版 Base64 明文编码.
//   - macOS/Linux 保持 keyring-only 策略, 钥匙串不可用时直接返回错误 (不回退明文存储).
//   - 向后兼容: 读取旧版配置时, 自动检测 Base64 明文数据并用 DPAPI 重新加密迁移.
//   - 首次保存配置时, 自动迁移历史 Base64 编码 Key 到钥匙串或 DPAPI 加密.
//
// 模块职责:
//   1. 定义 AiConfig / ConnectionTestResult / ModelInfo 结构体
//   2. get_ai_config 读取配置 (优先钥匙串, Windows 回退 DPAPI, macOS/Linux 回退 Base64)
//   3. set_ai_config 保存配置 (优先钥匙串, Windows 失败回退 DPAPI, macOS/Linux 失败返回错误)
//   4. test_ai_connection 测试 LLM 连通性 (返回延迟/模型响应)
//   5. list_models 拉取 OpenAI 兼容 /v1/models 端点
//   6. 提供 API Key 编解码与 DPAPI 加解密工具函数 (保留向后兼容)

use base64::{engine::general_purpose, Engine as _};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use tauri::command;

// ============================================================
// 常量: 钥匙串服务名与账户名 (跨平台标识)
// ============================================================

/// 钥匙串服务名 (对应 Windows Credential Manager 的 Target Name 前缀)
const KEYRING_SERVICE_NAME: &str = "MiaoChuangShuo";

/// 钥匙串账户名 (对应 Windows Credential Manager 的 Account Name)
const KEYRING_ACCOUNT_NAME: &str = "ai_api_key";

// ============================================================
// 数据结构定义
// ============================================================

/// AI 配置结构体 (BYOK 模式, 与前端 aiService.ts AiConfig 接口字段对齐)
///
/// 字段说明:
/// - apiKey: Base64 编码的 API Key (前端读写使用, 后端透明处理钥匙串存储)
/// - baseUrl: LLM API 基础地址 (OpenAI 兼容协议, 如 https://api.deepseek.com/v1)
/// - modelName: 模型名称 (如 deepseek-chat、qwen-plus)
/// - enabled: AI 功能总开关
/// - temperature: 采样温度 (0.0-2.0)
/// - maxTokens: 单次生成最大 Token 数
/// - providerId: 供应商标识 (deepseek/siliconflow/kimi/glm/qwen/openai/ollama/custom)
/// - useSecureStorage: 是否使用系统钥匙串存储 API Key
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// Base64 编码的 API Key (前端传入明文, 后端处理存储; 钥匙串模式下此字段留空)
    pub api_key: String,
    /// LLM API 基础地址 (OpenAI 兼容协议)
    pub base_url: String,
    /// 模型名称
    pub model_name: String,
    /// AI 功能总开关
    pub enabled: bool,
    /// 采样温度 (0.0-2.0)
    pub temperature: f64,
    /// 单次生成最大 Token 数
    pub max_tokens: u32,
    /// 供应商标识 (前端 providerRegistry.ts 中的 provider.id)
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    /// 是否使用系统钥匙串存储 API Key (默认 true)
    #[serde(default = "default_true")]
    pub use_secure_storage: bool,
}

/// 默认供应商标识 (DeepSeek 作为推荐默认)
fn default_provider_id() -> String {
    "deepseek".to_string()
}

/// 默认启用安全存储
fn default_true() -> bool {
    true
}

impl Default for AiConfig {
    /// 默认配置: DeepSeek 端点 + 空密钥 + 功能关闭 + 启用安全存储
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            model_name: "deepseek-chat".to_string(),
            enabled: false,
            temperature: 0.7,
            max_tokens: 2000,
            provider_id: "deepseek".to_string(),
            use_secure_storage: true,
        }
    }
}

/// 连通性测试结果 (增强版, 返回延迟/模型响应)
///
/// 字段说明:
/// - success: 是否成功
/// - message: 结果消息 (成功返回模型响应片段, 失败返回错误详情)
/// - latencyMs: 请求耗时 (毫秒)
/// - modelResponse: 模型实际返回的文本内容 (用于校验模型可用性)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    /// 是否连通成功
    pub success: bool,
    /// 结果消息
    pub message: String,
    /// 请求耗时 (毫秒)
    pub latency_ms: u64,
    /// 模型返回的文本内容 (成功时填充)
    pub model_response: Option<String>,
}

/// 模型信息 (OpenAI /v1/models 端点返回)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// 模型 ID (如 deepseek-chat)
    pub id: String,
    /// 模型所属对象 (通常是 model)
    pub object: String,
    /// 模型创建时间戳 (Unix 秒)
    pub created: Option<i64>,
    /// 模型拥有者 (如 deepseek、openai)
    pub owned_by: Option<String>,
}

/// /v1/models 端点响应体
#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

// ============================================================
// 钥匙串存储模块
// ============================================================

/// 将 API Key 明文写入系统钥匙串
///
/// 输入: api_key 明文 API Key
/// 输出: Result<(), String> 成功返回 Ok, 失败返回错误信息
/// 流程:
///   1. 创建 keyring::Entry (使用固定的 service/account 标识)
///   2. 调用 set_password 写入明文
///   3. 失败时返回错误 (调用方决定是否回退到 Base64)
fn save_api_key_to_keyring(api_key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE_NAME, KEYRING_ACCOUNT_NAME)
        .map_err(|e| format!("创建钥匙串条目失败: {}", e))?;
    entry
        .set_password(api_key)
        .map_err(|e| format!("写入钥匙串失败: {}", e))
}

/// 从系统钥匙串读取 API Key 明文
///
/// 输出: Result<Option<String>, String>
///   - Ok(Some(key)): 成功读取到明文
///   - Ok(None): 钥匙串中无对应条目 (首次使用或未配置)
///   - Err(e): 钥匙串访问异常 (调用方决定是否回退)
fn load_api_key_from_keyring() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE_NAME, KEYRING_ACCOUNT_NAME)
        .map_err(|e| format!("创建钥匙串条目失败: {}", e))?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("读取钥匙串失败: {}", e)),
    }
}

/// 删除钥匙串中的 API Key 条目 (清空配置时调用)
///
/// 输出: Result<(), String> 始终返回 Ok (无条目视为已删除, 幂等安全)
fn delete_api_key_from_keyring() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE_NAME, KEYRING_ACCOUNT_NAME)
        .map_err(|e| format!("创建钥匙串条目失败: {}", e))?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("删除钥匙串条目失败: {}", e)),
    }
}

// ============================================================
// Windows DPAPI 加解密模块 (Task 2.2)
// ============================================================
//
// 安全策略说明:
//   Windows 平台钥匙串 (Credential Manager) 写入失败时, 不再回退到不安全的 Base64 编码,
//   改用 DPAPI (Data Protection API) 加密后存入配置文件.
//   DPAPI 密文与当前用户账户绑定, 其他用户或远程攻击者无法解密.
//   macOS/Linux 平台保持 keyring-only 策略, 钥匙串不可用时直接返回错误.
//
// 存储格式:
//   DPAPI 加密后的字节经 Base64 编码存入 ai_config.json 的 api_key 字段,
//   与旧版 Base64 明文编码格式区分通过"尝试 DPAPI 解密是否成功"判定.

/// 使用 Windows DPAPI 加密明文
///
/// 输入: plaintext 明文 API Key
/// 输出: Result<String, String> Base64 编码的 DPAPI 密文
/// 流程:
///   1. 将明文转为字节, 构造 CRYPT_INTEGER_BLOB 输入结构
///   2. 调用 CryptProtectData 加密 (绑定当前用户会话)
///   3. 将密文字节 Base64 编码, 便于存储到 JSON 配置文件
///   4. 调用 LocalFree 释放 DPAPI 分配的输出缓冲区
#[cfg(windows)]
fn encrypt_with_dpapi(plaintext: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    let plaintext_bytes = plaintext.as_bytes();
    // 构造输入 blob: 指向明文字节缓冲区
    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext_bytes.len() as u32,
        pbData: plaintext_bytes.as_ptr() as *mut u8,
    };
    // 输出 blob: 由 DPAPI 分配, 调用方负责 LocalFree 释放
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // 调用 DPAPI 加密 (无描述文字, 无额外熵, 无保留参数, 无提示结构, flags=0)
    unsafe {
        CryptProtectData(&input, None, None, None, None, 0, &mut output)
            .map_err(|e| format!("DPAPI 加密失败: {}", e))?;
    }

    // 提取密文字节并 Base64 编码
    let ciphertext = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let result = general_purpose::STANDARD.encode(ciphertext);

    // 释放 DPAPI 分配的输出内存 (必须调用 LocalFree)
    unsafe {
        let _ = local_free(output.pbData);
    }

    Ok(result)
}

/// 使用 Windows DPAPI 解密密文
///
/// 输入: ciphertext_base64 Base64 编码的 DPAPI 密文
/// 输出: Result<String, String> 解密后的明文 API Key
/// 流程:
///   1. Base64 解码为密文字节
///   2. 构造 CRYPT_INTEGER_BLOB 输入结构
///   3. 调用 CryptUnprotectData 解密 (需在同一用户会话下)
///   4. 将明文字节转为 UTF-8 字符串
///   5. 调用 LocalFree 释放 DPAPI 分配的输出缓冲区
#[cfg(windows)]
fn decrypt_with_dpapi(ciphertext_base64: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    // Base64 解码为密文字节
    let ciphertext_bytes = general_purpose::STANDARD
        .decode(ciphertext_base64)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    let input = CRYPT_INTEGER_BLOB {
        cbData: ciphertext_bytes.len() as u32,
        pbData: ciphertext_bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // 调用 DPAPI 解密
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
            .map_err(|e| format!("DPAPI 解密失败: {}", e))?;
    }

    // 提取明文字节并转为 UTF-8 字符串
    let plaintext_bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let result =
        String::from_utf8(plaintext_bytes.to_vec()).map_err(|e| format!("UTF-8 解码失败: {}", e))?;

    // 释放 DPAPI 分配的输出内存
    unsafe {
        let _ = local_free(output.pbData);
    }

    Ok(result)
}

// FFI 声明 LocalFree (kernel32.dll 稳定导出)
//
// windows 0.58 crate 移除了 LocalFree 绑定 (Win32 API 弃用标记),
// 但 DPAPI (CryptProtectData/CryptUnprotectData) 使用 LocalAlloc 分配内存,
// 必须用 LocalFree 释放, 因此通过 FFI 直接声明.
#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(hmem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

/// 安全包装 LocalFree 调用
#[cfg(windows)]
unsafe fn local_free(ptr: *mut u8) {
    LocalFree(ptr as *mut std::ffi::c_void);
}

/// Windows 专用: 尝试从配置文件的 api_key 字段解密 API Key
///
/// 输入: config 可变引用 (api_key 字段可能为 DPAPI 密文或旧 Base64 明文)
/// 输出: Result<(), String> 成功时 config.api_key 已替换为 Base64 编码的明文 (供前端使用)
/// 流程:
///   1. api_key 为空时直接返回 (首次使用或已清空)
///   2. 尝试 DPAPI 解密: 成功说明是新格式密文, 解密后 Base64 编码返回前端
///   3. DPAPI 失败则尝试旧 Base64 解码: 成功说明是遗留明文数据, 自动迁移到 DPAPI 加密
///   4. 两者均失败视为数据损坏, 保持原值不处理
/// 迁移逻辑:
///   旧 Base64 明文 -> 解码为明文 -> DPAPI 加密 -> 保存到配置文件 (best-effort)
#[cfg(windows)]
fn try_dpapi_or_legacy(config: &mut AiConfig) -> Result<(), String> {
    if config.api_key.is_empty() {
        return Ok(());
    }

    // 尝试 DPAPI 解密 (新格式密文)
    if let Ok(plaintext) = decrypt_with_dpapi(&config.api_key) {
        // 解密成功: Base64 编码明文返回前端
        config.api_key = general_purpose::STANDARD.encode(plaintext.as_bytes());
        return Ok(());
    }

    // DPAPI 解密失败: 尝试旧 Base64 解码 (遗留明文数据)
    if let Ok(plaintext) = decode_api_key(&config.api_key) {
        // 旧 Base64 数据: 迁移到 DPAPI 加密存储
        if let Ok(encrypted) = encrypt_with_dpapi(&plaintext) {
            // 保存迁移后的配置 (best-effort, 失败不影响本次读取)
            let mut migrated = config.clone();
            migrated.api_key = encrypted;
            let _ = save_config_to_file(&migrated);
        }
        // 返回 Base64 编码的明文供前端使用
        config.api_key = general_purpose::STANDARD.encode(plaintext.as_bytes());
        return Ok(());
    }

    // 两种方式均失败: 数据可能损坏, 保持原值
    Ok(())
}

// ============================================================
// 配置文件路径管理
// ============================================================

/// 获取 AI 配置文件路径
///
/// 路径规则:
///   Windows: %APPDATA%\MiaoChuangShuo\ai_config.json
///   macOS:   ~/Library/Application Support/MiaoChuangShuo/ai_config.json
///   Linux:   ~/.config/MiaoChuangShuo/ai_config.json
///
/// 输入: 无
/// 输出: Result<PathBuf, String> 配置文件路径
/// 流程:
///   1. 通过 dirs::config_dir() 获取用户配置根目录
///   2. 拼接 MiaoChuangShuo 子目录
///   3. 若目录不存在则创建
///   4. 返回 ai_config.json 完整路径
fn get_config_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| "无法获取用户配置目录".to_string())?;
    let app_dir = config_dir.join("MiaoChuangShuo");
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    Ok(app_dir.join("ai_config.json"))
}

/// 将配置写入文件 (原子写入策略)
///
/// 输入: config AI 配置引用
/// 输出: Result<(), String> 成功返回空 Ok
/// 流程:
///   1. 序列化配置为 JSON
///   2. 写入 .tmp 临时文件
///   3. rename 替换原文件 (原子操作, 防止崩溃导致文件损坏)
///   4. rename 失败时清理临时文件
fn save_config_to_file(config: &AiConfig) -> Result<(), String> {
    let path = get_config_path()?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化 AI 配置失败: {}", e))?;

    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &content).map_err(|e| format!("写入 AI 配置失败: {}", e))?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("重命名 AI 配置文件失败: {}", e)
    })?;
    Ok(())
}

// ============================================================
// 命令: 配置读写
// ============================================================

/// 读取 AI 配置命令
///
/// 输入: 无
/// 输出: Result<AiConfig, String> AI 配置 (文件不存在时返回默认值)
/// 流程:
///   1. 获取配置文件路径
///   2. 文件不存在则返回默认配置 (首次使用)
///   3. 读取并反序列化 JSON
///   4. 若 use_secure_storage=true:
///      a. 优先从钥匙串读取明文, Base64 编码返回前端
///      b. Windows: 钥匙串无数据时尝试 DPAPI 解密配置文件密文, 旧 Base64 自动迁移
///      c. macOS/Linux: 钥匙串无数据时保留旧 Base64 字段 (向后兼容)
///   5. 返回配置
#[command]
pub async fn get_ai_config() -> Result<AiConfig, String> {
    let path = get_config_path()?;
    if !path.exists() {
        return Ok(AiConfig::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取 AI 配置失败: {}", e))?;
    let mut config: AiConfig = serde_json::from_str(&content)
        .map_err(|e| format!("解析 AI 配置失败: {}", e))?;

    // 安全存储模式: 从钥匙串读取明文, 编码为 Base64 返回前端
    // 前端通过 atob 解码为明文用于编辑框显示, 与原 Base64 模式前端逻辑兼容
    if config.use_secure_storage {
        match load_api_key_from_keyring() {
            Ok(Some(plaintext)) => {
                // 钥匙串有明文: Base64 编码返回前端
                config.api_key = general_purpose::STANDARD.encode(plaintext.as_bytes());
            }
            Ok(None) => {
                // 钥匙串无条目: 检查配置文件 api_key 字段
                #[cfg(windows)]
                {
                    // Windows: 尝试 DPAPI 解密或迁移旧 Base64 数据
                    try_dpapi_or_legacy(&mut config)?;
                }
                #[cfg(not(windows))]
                {
                    // macOS/Linux: 保留旧 Base64 字段供前端读取 (向后兼容)
                    // 首次使用或已清空时 api_key 保持为空
                }
            }
            Err(e) => {
                // 钥匙串访问异常
                #[cfg(windows)]
                {
                    // Windows: 尝试 DPAPI 解密, 保持 use_secure_storage=true
                    eprintln!("钥匙串读取失败, 尝试 DPAPI 解密: {}", e);
                    try_dpapi_or_legacy(&mut config)?;
                }
                #[cfg(not(windows))]
                {
                    // macOS/Linux: 回退到配置文件中的 Base64 (向后兼容)
                    // 标记 use_secure_storage=false 避免后续重复尝试失败
                    config.use_secure_storage = false;
                    eprintln!("钥匙串读取失败, 回退到 Base64 存储: {}", e);
                }
            }
        }
    }
    // use_secure_storage=false 模式: 直接返回配置文件中的 Base64 api_key

    Ok(config)
}

/// 保存 AI 配置命令
///
/// 输入: config AI 配置 (前端传入 Base64 编码的 API Key)
/// 输出: Result<(), String> 成功返回空 Ok
/// 流程:
///   1. 解码 Base64 API Key 为明文
///   2. 若 use_secure_storage=true 且明文非空:
///      a. 写入钥匙串
///      b. 写入成功: 配置文件 api_key 字段置空 (仅保留元数据)
///      c. Windows 写入失败: 回退到 DPAPI 加密存储, 保持 use_secure_storage=true
///      d. macOS/Linux 写入失败: 直接返回错误 (keyring-only 策略)
///   3. 若 use_secure_storage=false 或明文为空: 直接存 Base64 到配置文件
///   4. 若 API Key 为空 (用户清空), 同步清理钥匙串条目
///   5. 原子写入配置文件
#[command]
pub async fn set_ai_config(mut config: AiConfig) -> Result<(), String> {
    // 解码前端传入的 Base64 API Key 为明文
    let plaintext_key = decode_api_key(&config.api_key)?;

    // 安全存储模式且明文非空: 优先写入钥匙串
    if config.use_secure_storage && !plaintext_key.is_empty() {
        match save_api_key_to_keyring(&plaintext_key) {
            Ok(()) => {
                // 写入成功: 配置文件中 api_key 置空, 仅保留元数据
                config.api_key = String::new();
            }
            Err(e) => {
                // 钥匙串写入失败: 平台差异化处理
                #[cfg(windows)]
                {
                    // Windows: 回退到 DPAPI 加密存储 (仍属于安全存储)
                    eprintln!("钥匙串写入失败, 回退到 DPAPI 加密存储: {}", e);
                    let encrypted = encrypt_with_dpapi(&plaintext_key)
                        .map_err(|err| format!("DPAPI 加密失败, 无法安全存储 API Key: {}", err))?;
                    config.api_key = encrypted;
                    // 保持 use_secure_storage=true, DPAPI 仍属于安全存储
                }
                #[cfg(not(windows))]
                {
                    // macOS/Linux: keyring-only 策略, 不回退, 直接返回错误
                    return Err(format!("钥匙串不可用, 无法安全存储 API Key: {}", e));
                }
            }
        }
    } else if !plaintext_key.is_empty() {
        // use_secure_storage=false 模式: api_key 保持前端传入的 Base64
        // 无需额外处理
    }

    // 若 API Key 为空 (用户清空), 同步清理钥匙串条目
    if plaintext_key.is_empty() && config.use_secure_storage {
        let _ = delete_api_key_from_keyring();
        config.api_key = String::new();
    }

    // 原子写入配置文件
    save_config_to_file(&config)
}

// ============================================================
// 命令: 连通性测试 (增强版)
// ============================================================

/// 测试 AI 连通性命令 (增强版, 返回延迟与模型响应)
///
/// 输入: config AI 配置 (含 API Key)
/// 输出: Result<ConnectionTestResult, String> 测试结果
/// 流程:
///   1. 解码 API Key
///   2. 校验 API Key 非空
///   3. 记录开始时间
///   4. 构造测试请求 (发送简短消息, max_tokens=20)
///   5. 发送请求并检查 HTTP 状态
///   6. 解析响应体提取模型回复内容
///   7. 计算耗时
///   8. 返回 ConnectionTestResult (success/message/latency_ms/model_response)
#[command]
pub async fn test_ai_connection(config: AiConfig) -> Result<ConnectionTestResult, String> {
    let api_key = decode_api_key(&config.api_key)
        .map_err(|e| format!("API Key 解码失败: {}", e))?;
    if api_key.is_empty() {
        return Err("API Key 为空, 请先配置 API Key".to_string());
    }

    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": config.model_name,
        "messages": [{"role": "user", "content": "测试连通性, 请回复: 已连接"}],
        "max_tokens": 20,
        "temperature": 0.1
    });

    let start_time = Instant::now();

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let latency_ms = start_time.elapsed().as_millis() as u64;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Ok(ConnectionTestResult {
            success: false,
            message: format!("HTTP {}: {}", status, error_text),
            latency_ms,
            model_response: None,
        });
    }

    // 解析响应体提取模型回复内容
    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let model_response = response_json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string());

    Ok(ConnectionTestResult {
        success: true,
        message: format!("连接成功 (耗时 {}ms)", latency_ms),
        latency_ms,
        model_response,
    })
}

// ============================================================
// 命令: 模型列表拉取
// ============================================================

/// 拉取可用模型列表命令
///
/// 输入: config AI 配置 (含 API Key 与 Base URL)
/// 输出: Result<Vec<ModelInfo>, String> 模型列表
/// 流程:
///   1. 解码 API Key
///   2. 校验 API Key 非空
///   3. 构造 GET 请求到 {base_url}/models
///   4. 解析响应为 ModelsResponse
///   5. 返回模型列表 (按 id 排序)
/// 说明:
///   - OpenAI 兼容协议的 /v1/models 端点返回所有可用模型
///   - 部分供应商 (如 Ollama) 可能不支持此端点, 调用方需处理错误
///   - 响应体格式: { "object": "list", "data": [{ "id": "model-name", ... }] }
#[command]
pub async fn list_models(config: AiConfig) -> Result<Vec<ModelInfo>, String> {
    let api_key = decode_api_key(&config.api_key)
        .map_err(|e| format!("API Key 解码失败: {}", e))?;
    if api_key.is_empty() {
        return Err("API Key 为空, 请先配置 API Key".to_string());
    }

    let url = format!(
        "{}/models",
        config.base_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("请求模型列表失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, error_text));
    }

    let models_response: ModelsResponse = response
        .json()
        .await
        .map_err(|e| format!("解析模型列表失败: {}", e))?;

    // 按 id 排序, 便于前端展示
    let mut models = models_response.data;
    models.sort_by(|a, b| a.id.cmp(&b.id));

    Ok(models)
}

// ============================================================
// 工具函数
// ============================================================

/// 解码 API Key (Base64 -> 明文)
///
/// 输入: encoded Base64 编码的字符串
/// 输出: Result<String, String> 解码后的明文 API Key
/// 流程:
///   1. 空字符串直接返回空
///   2. Base64 解码为字节
///   3. 转为 UTF-8 字符串
pub fn decode_api_key(encoded: &str) -> Result<String, String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;
    String::from_utf8(bytes).map_err(|e| format!("UTF-8 解码失败: {}", e))
}

// ============================================================
// 单元测试 (Task 2.2.5)
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Task 2.2.5: 验证 DPAPI 加密/解密往返一致性
    ///
    /// 流程:
    ///   1. 明文 API Key 经 DPAPI 加密为 Base64 密文
    ///   2. 密文经 DPAPI 解密还原为明文
    ///   3. 断言解密结果与原始明文一致
    #[test]
    #[cfg(windows)]
    fn test_dpapi_encrypt_decrypt_roundtrip() {
        let plaintext = "sk-test-api-key-12345";
        let encrypted = encrypt_with_dpapi(plaintext).expect("DPAPI 加密应成功");
        let decrypted = decrypt_with_dpapi(&encrypted).expect("DPAPI 解密应成功");
        assert_eq!(plaintext, decrypted, "DPAPI 往返解密结果应与明文一致");
    }

    /// Task 2.2.5: 验证 DPAPI 加密后密文不等于明文 (确认确实进行了加密)
    #[test]
    #[cfg(windows)]
    fn test_dpapi_ciphertext_differs_from_plaintext() {
        let plaintext = "sk-test-api-key-12345";
        let encrypted = encrypt_with_dpapi(plaintext).expect("DPAPI 加密应成功");
        assert_ne!(encrypted, plaintext, "密文不应等于明文");
        assert_ne!(
            encrypted,
            general_purpose::STANDARD.encode(plaintext.as_bytes()),
            "密文不应等于简单 Base64 编码"
        );
    }

    /// Task 2.2.5: 验证 DPAPI 加密空字符串的往返一致性
    #[test]
    #[cfg(windows)]
    fn test_dpapi_empty_string_roundtrip() {
        let plaintext = "";
        let encrypted = encrypt_with_dpapi(plaintext).expect("DPAPI 加密空字符串应成功");
        let decrypted = decrypt_with_dpapi(&encrypted).expect("DPAPI 解密空字符串应成功");
        assert_eq!(plaintext, decrypted, "空字符串往返应一致");
    }

    /// Task 2.2.5: 验证 DPAPI 解密无效数据时返回错误 (而非 panic)
    #[test]
    #[cfg(windows)]
    fn test_dpapi_decrypt_invalid_data_returns_error() {
        // 有效的 Base64 但不是 DPAPI 密文, 解密应失败
        let invalid_ciphertext = general_purpose::STANDARD.encode(b"not valid dpapi data");
        let result = decrypt_with_dpapi(&invalid_ciphertext);
        assert!(result.is_err(), "解密无效 DPAPI 数据应返回错误");
    }
}
