// 版本号同步脚本
//
// 功能概述:
// 接受版本号参数,自动同步更新项目中 6 处文件的版本号字段,
// 保证 package.json / Cargo.toml / Cargo.lock / tauri.conf.json /
// updateChecker.ts / useVersionCheck.ts 版本号一致。
//
// 模块职责:
// 1. 校验输入版本号格式(YY.MM.修改序号)
// 2. 按各文件格式(JSON / TOML / 正则 / 字符串)解析并更新版本号
// 3. 输出每处文件更新前后的版本号对比日志
// 4. 文件不存在或正则不匹配时打印错误并退出
//
// 使用方式:
//   node scripts/sync-version.mjs 26.8.0
//
// 退出码:
//   0 - 全部更新成功
//   1 - 参数缺失 / 格式校验失败 / 文件读取或写入失败 / 正则不匹配

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 项目根目录(脚本位于 scripts/ 下,根目录为上一级)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// 版本号格式校验正则:YY.MM.修改序号
// YY: 两位年份(如 26)
// MM: 1-2 位月份或序号(如 8 / 12)
// 修改序号: 1-3 位数字(如 0 / 30 / 100)
const VERSION_REGEX = /^\d{2}\.\d{1,2}\.\d{1,3}$/;

// 项目包名(用于在 Cargo.lock 中定位包条目)
const PACKAGE_NAME = "miaochuangshuo";

/**
 * 打印日志前缀的工具函数
 * 输入: 消息字符串
 * 输出: 带前缀的控制台输出
 */
function logInfo(message) {
  console.log(`[sync-version] ${message}`);
}

function logError(message) {
  console.error(`[sync-version][错误] ${message}`);
}

function logSuccess(message) {
  console.log(`[sync-version][成功] ${message}`);
}

/**
 * 校验版本号格式
 * 输入: 版本号字符串
 * 输出: 校验通过返回 true,否则返回 false
 */
function validateVersion(version) {
  return VERSION_REGEX.test(version);
}

/**
 * 读取文件内容
 * 输入: 相对于项目根目录的文件路径
 * 输出: 文件内容字符串
 * 异常: 文件不存在或读取失败时抛出 Error
 */
function readFile(relativePath) {
  const absolutePath = resolve(PROJECT_ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`文件不存在: ${absolutePath}`);
  }
  return readFileSync(absolutePath, "utf-8");
}

/**
 * 写入文件内容
 * 输入:
 *   relativePath 相对于项目根目录的文件路径
 *   content 要写入的字符串内容
 * 输出: 无
 */
function writeFile(relativePath, content) {
  const absolutePath = resolve(PROJECT_ROOT, relativePath);
  writeFileSync(absolutePath, content, "utf-8");
}

/**
 * 更新 package.json 的 version 字段
 * 输入: newVersion 新版本号
 * 输出: { before, after } 更新前后版本号
 */
function updatePackageJson(newVersion) {
  const relativePath = "package.json";
  const content = readFile(relativePath);
  const data = JSON.parse(content);
  const before = data.version;
  data.version = newVersion;
  writeFile(relativePath, JSON.stringify(data, null, 2) + "\n");
  return { before, after: newVersion, file: relativePath };
}

/**
 * 更新 package-lock.json 的 version 字段(根 version 与 packages[""].version)
 * 输入: newVersion 新版本号
 * 输出: { before, after } 更新前后版本号
 */
function updatePackageLockJson(newVersion) {
  const relativePath = "package-lock.json";
  const content = readFile(relativePath);
  const data = JSON.parse(content);
  const before = data.version;
  data.version = newVersion;
  if (data.packages && data.packages[""] && data.packages[""].version) {
    data.packages[""].version = newVersion;
  }
  writeFile(relativePath, JSON.stringify(data, null, 2) + "\n");
  return { before, after: newVersion, file: relativePath };
}

/**
 * 更新 Cargo.toml 的 version 字段(仅 [package] 段下的 version)
 * 输入: newVersion 新版本号
 * 输出: { before, after } 更新前后版本号
 */
function updateCargoToml(newVersion) {
  const relativePath = "src-tauri/Cargo.toml";
  const content = readFile(relativePath);
  // 匹配 [package] 段下的 version = "x.y.z"(行首开头)
  const regex = /^(\[package\]\s*(?:[^\[]*?))version\s*=\s*"([^"]+)"/m;
  const match = content.match(regex);
  if (!match) {
    throw new Error(`Cargo.toml 中未匹配到 [package] 段下的 version 字段`);
  }
  const before = match[2];
  // 仅替换 version = "..." 部分的值
  const newContent = content.replace(
    /^(\[package\]\s*(?:[^\[]*?))version\s*=\s*"([^"]+)"/m,
    `$1version = "${newVersion}"`
  );
  writeFile(relativePath, newContent);
  return { before, after: newVersion, file: relativePath };
}

/**
 * 更新 Cargo.lock 中指定包名条目的 version 字段
 * 输入: newVersion 新版本号
 * 输出: { before, after } 更新前后版本号
 */
function updateCargoLock(newVersion) {
  const relativePath = "src-tauri/Cargo.lock";
  const content = readFile(relativePath);
  // 匹配 name = "miaochuangshuo" 紧跟其后的 version = "x.y.z"
  const regex = new RegExp(
    `^(name\\s*=\\s*"${PACKAGE_NAME}"\\s*\\nversion\\s*=\\s*")([^"]+)(")`,
    "m"
  );
  const match = content.match(regex);
  if (!match) {
    throw new Error(
      `Cargo.lock 中未匹配到 name="${PACKAGE_NAME}" 包条目的 version 字段`
    );
  }
  const before = match[2];
  const newContent = content.replace(regex, `$1${newVersion}$3`);
  writeFile(relativePath, newContent);
  return { before, after: newVersion, file: relativePath };
}

/**
 * 更新 tauri.conf.json 的 version 字段
 * 输入: newVersion 新版本号
 * 输出: { before, after } 更新前后版本号
 */
function updateTauriConfJson(newVersion) {
  const relativePath = "src-tauri/tauri.conf.json";
  const content = readFile(relativePath);
  const data = JSON.parse(content);
  const before = data.version;
  data.version = newVersion;
  writeFile(relativePath, JSON.stringify(data, null, 2) + "\n");
  return { before, after: newVersion, file: relativePath };
}

/**
 * 更新 updateChecker.ts 的 FALLBACK_VERSION 常量
 * 输入: newVersion 新版本号
 * 输出: { before, after } 更新前后版本号
 */
function updateUpdateChecker(newVersion) {
  const relativePath = "src/lib/updateChecker.ts";
  const content = readFile(relativePath);
  // 匹配 export const FALLBACK_VERSION = "x.y.z";
  const regex = /(export\s+const\s+FALLBACK_VERSION\s*=\s*")([^"]+)(")/;
  const match = content.match(regex);
  if (!match) {
    throw new Error(`updateChecker.ts 中未匹配到 FALLBACK_VERSION 常量`);
  }
  const before = match[2];
  const newContent = content.replace(regex, `$1${newVersion}$3`);
  writeFile(relativePath, newContent);
  return { before, after: newVersion, file: relativePath };
}

/**
 * 更新 useVersionCheck.ts 的 DEFAULT_APP_VERSION 常量(若存在)
 * SubTask 7.1.2 已重构该文件,常量被删除改为从 updateChecker 导入 FALLBACK_VERSION,
 * 若常量已不存在则跳过此文件并打印提示
 * 输入: newVersion 新版本号
 * 输出: { before, after, skipped } 更新前后版本号与跳过标记
 */
function updateUseVersionCheck(newVersion) {
  const relativePath = "src/hooks/useVersionCheck.ts";
  const content = readFile(relativePath);
  // 匹配 const DEFAULT_APP_VERSION = "x.y.z";
  const regex = /(const\s+DEFAULT_APP_VERSION\s*=\s*")([^"]+)(")/;
  const match = content.match(regex);
  if (!match) {
    // 常量已重构删除,跳过此文件
    return {
      before: "(已重构移除)",
      after: "(已通过 FALLBACK_VERSION 间接同步)",
      file: relativePath,
      skipped: true,
    };
  }
  const before = match[2];
  const newContent = content.replace(regex, `$1${newVersion}$3`);
  writeFile(relativePath, newContent);
  return { before, after: newVersion, file: relativePath, skipped: false };
}

/**
 * 主函数: 解析参数、校验、执行更新、输出日志
 * 输入: 命令行参数数组
 * 输出: 无(成功时退出码 0,失败时退出码 1)
 */
function main() {
  // 解析命令行参数(node scripts/sync-version.mjs 26.8.0 → process.argv[2])
  const versionArg = process.argv[2];
  if (!versionArg) {
    logError("缺少版本号参数,使用方式: node scripts/sync-version.mjs <版本号>");
    logError("示例: node scripts/sync-version.mjs 26.8.0");
    process.exit(1);
  }

  // 校验版本号格式
  if (!validateVersion(versionArg)) {
    logError(
      `版本号格式不合法: ${versionArg},应匹配正则 ${VERSION_REGEX.source}(YY.MM.修改序号)`
    );
    process.exit(1);
  }

  logInfo(`开始同步版本号到 ${versionArg}`);
  console.log("");

  // 定义更新任务列表(顺序执行)
  const updateTasks = [
    { name: "package.json", fn: () => updatePackageJson(versionArg) },
    { name: "package-lock.json", fn: () => updatePackageLockJson(versionArg) },
    { name: "Cargo.toml", fn: () => updateCargoToml(versionArg) },
    { name: "Cargo.lock", fn: () => updateCargoLock(versionArg) },
    { name: "tauri.conf.json", fn: () => updateTauriConfJson(versionArg) },
    { name: "updateChecker.ts", fn: () => updateUpdateChecker(versionArg) },
    { name: "useVersionCheck.ts", fn: () => updateUseVersionCheck(versionArg) },
  ];

  const results = [];
  let failedCount = 0;

  for (const task of updateTasks) {
    try {
      const result = task.fn();
      results.push(result);
      if (result.skipped) {
        logInfo(`跳过 ${result.file}(${result.before})`);
      } else if (result.before === result.after) {
        logInfo(`保持 ${result.file}: ${result.before}(已是目标版本)`);
      } else {
        logSuccess(
          `更新 ${result.file}: ${result.before} → ${result.after}`
        );
      }
    } catch (error) {
      results.push({ file: task.name, error: error.message });
      logError(`更新 ${task.name} 失败: ${error.message}`);
      failedCount++;
    }
  }

  console.log("");
  logInfo(`同步完成: 成功 ${results.length - failedCount} 处,失败 ${failedCount} 处`);

  if (failedCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
