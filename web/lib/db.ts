// IndexedDB 封装 (Web 版数据持久层)
//
// 功能概述:
// 为「喵创说」在线体验版提供基于 IndexedDB 的本地数据存储。
// 包含两个对象仓库: projects (项目) 与 chapters (章节)。
// 所有数据存储在浏览器本地, 不上传任何服务器, 不依赖 Tauri。
//
// 模块职责:
// 1. 初始化 IndexedDB 数据库与对象仓库
// 2. 项目 CRUD: 创建/列出/获取/更新/删除
// 3. 章节 CRUD: 创建/列出/获取/更新/删除 (按项目隔离)
// 4. 提供 UUID 生成工具
// 5. 首次访问时注入示例项目 (由 sampleData 模块提供数据)

import type { WebProject, WebChapter, ProseMirrorNode } from "./types";
import { createEmptyDoc } from "./types";
import { countWordsFromProseMirror } from "./wordCount";
import { getSampleProject, getSampleChapters } from "./sampleData";

// 数据库名称
const DB_NAME = "miaochuangshuo-web";
// 数据库版本
const DB_VERSION = 1;
// 项目仓库
const STORE_PROJECTS = "projects";
// 章节仓库
const STORE_CHAPTERS = "chapters";
// 首次初始化标记键 (localStorage)
const INIT_FLAG_KEY = "miaochuangshuo-web-initialized";

/**
 * 生成 RFC4122 风格的 UUID v4
 * 输入: 无
 * 输出: 形如 xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx 的字符串
 * 流程:
 *   1. 优先使用原生 crypto.randomUUID
 *   2. 回退到基于 crypto.getRandomValues 的手动实现
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 回退方案: 手动生成 UUID v4
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 设置版本号 (4) 与变体位
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * 打开并初始化 IndexedDB 数据库
 * 输入: 无
 * 输出: Promise<IDBDatabase> 数据库实例
 * 流程:
 *   1. 调用 indexedDB.open 打开/创建数据库
 *   2. onupgradeneeded 中创建 projects / chapters 仓库并建立索引
 *   3. 首次打开时调用 ensureSampleData 注入示例项目
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // 创建项目仓库, 以 id 为主键
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      }
      // 创建章节仓库, 以 id 为主键, projectId 为索引
      if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
        const chapterStore = db.createObjectStore(STORE_CHAPTERS, { keyPath: "id" });
        chapterStore.createIndex("projectId", "projectId", { unique: false });
        chapterStore.createIndex("order", "order", { unique: false });
      }
    };
    request.onsuccess = (event: Event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };
    request.onerror = (event: Event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/**
 * 在事务中执行仓库操作, 返回 Promise
 * 输入:
 *   storeName - 仓库名称
 *   mode - 事务模式 (readonly / readwrite)
 *   executor - 接收 store 的回调, 返回 IDBRequest
 * 输出: Promise<请求结果>
 * 流程:
 *   1. 打开数据库
 *   2. 开启指定模式的事务
 *   3. 在 executor 中执行操作
 *   4. 事务完成后 resolve / 出错时 reject
 */
function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = executor(store);
        request.onsuccess = () => {
          resolve(request.result as T);
        };
        request.onerror = () => {
          reject(request.error);
        };
        tx.oncomplete = () => {
          db.close();
        };
        tx.onerror = () => {
          reject(tx.error);
        };
      })
      .catch((e) => reject(e));
  });
}

// ========== 项目 CRUD ==========

/**
 * 列出所有项目, 按最后修改时间倒序
 * 输入: 无
 * 输出: Promise<WebProject[]> 项目数组
 * 流程: 通过 getAll 获取全部项目, 按 updatedAt 倒序排序
 */
export async function listProjects(): Promise<WebProject[]> {
  const projects = await withStore<WebProject[]>(
    STORE_PROJECTS,
    "readonly",
    (store) => store.getAll() as IDBRequest<WebProject[]>
  );
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * 创建新项目
 * 输入: name 项目名称, type 项目类型 (默认 novel)
 * 输出: Promise<WebProject> 创建完成的项目对象
 * 流程:
 *   1. 生成项目 ID
 *   2. 构造项目对象
 *   3. 写入 IndexedDB
 */
export async function createProject(
  name: string,
  type: string = "novel"
): Promise<WebProject> {
  const now = new Date().toISOString();
  const project: WebProject = {
    id: generateId(),
    name,
    type,
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
  };
  await withStore(STORE_PROJECTS, "readwrite", (store) => store.add(project));
  return project;
}

/**
 * 获取单个项目
 * 输入: id 项目 ID
 * 输出: Promise<WebProject | null> 项目对象, 不存在时返回 null
 */
export async function getProject(id: string): Promise<WebProject | null> {
  const project = await withStore<WebProject | undefined>(
    STORE_PROJECTS,
    "readonly",
    (store) => store.get(id) as IDBRequest<WebProject | undefined>
  );
  return project ?? null;
}

/**
 * 更新项目 (名称与字数)
 * 输入:
 *   id - 项目 ID
 *   patch - 待更新字段
 * 输出: Promise<void>
 * 流程:
 *   1. 读取原项目
 *   2. 合并 patch, 更新 updatedAt
 *   3. 写回 IndexedDB
 */
export async function updateProject(
  id: string,
  patch: Partial<Pick<WebProject, "name" | "wordCount">>
): Promise<void> {
  const existing = await getProject(id);
  if (!existing) {
    throw new Error(`项目不存在: ${id}`);
  }
  const updated: WebProject = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await withStore(STORE_PROJECTS, "readwrite", (store) => store.put(updated));
}

/**
 * 删除项目及其所有章节
 * 输入: id 项目 ID
 * 输出: Promise<void>
 * 流程:
 *   1. 列出该项目下所有章节
 *   2. 删除所有章节
 *   3. 删除项目本身
 */
export async function deleteProject(id: string): Promise<void> {
  const chapters = await listChapters(id);
  await Promise.all(chapters.map((ch) => deleteChapter(ch.id)));
  await withStore(STORE_PROJECTS, "readwrite", (store) => store.delete(id));
}

// ========== 章节 CRUD ==========

/**
 * 列出指定项目下的所有章节, 按 order 升序
 * 输入: projectId 项目 ID
 * 输出: Promise<WebChapter[]> 章节数组
 * 流程: 通过索引 projectId 查询, 按 order 升序排序
 */
export async function listChapters(projectId: string): Promise<WebChapter[]> {
  const db = await openDb();
  try {
    return await new Promise<WebChapter[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CHAPTERS, "readonly");
      const store = tx.objectStore(STORE_CHAPTERS);
      const index = store.index("projectId");
      const request = index.getAll(IDBKeyRange.only(projectId));
      request.onsuccess = () => {
        const chapters = request.result as WebChapter[];
        chapters.sort((a, b) => a.order - b.order);
        resolve(chapters);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/**
 * 创建新章节
 * 输入:
 *   projectId - 所属项目 ID
 *   name - 章节名称
 *   content - ProseMirror JSON 内容 (可选, 默认空文档)
 * 输出: Promise<WebChapter> 创建完成的章节对象
 * 流程:
 *   1. 查询当前项目下章节数量, 确定 order
 *   2. 生成章节 ID 与时间戳
 *   3. 计算字数
 *   4. 写入 IndexedDB
 */
export async function createChapter(
  projectId: string,
  name: string,
  content: ProseMirrorNode = createEmptyDoc()
): Promise<WebChapter> {
  const existing = await listChapters(projectId);
  const now = new Date().toISOString();
  const chapter: WebChapter = {
    id: generateId(),
    projectId,
    name,
    content,
    order: existing.length,
    createdAt: now,
    updatedAt: now,
    wordCount: countWordsFromProseMirror(content),
  };
  await withStore(STORE_CHAPTERS, "readwrite", (store) => store.add(chapter));
  return chapter;
}

/**
 * 获取单个章节
 * 输入: id 章节 ID
 * 输出: Promise<WebChapter | null>
 */
export async function getChapter(id: string): Promise<WebChapter | null> {
  const chapter = await withStore<WebChapter | undefined>(
    STORE_CHAPTERS,
    "readonly",
    (store) => store.get(id) as IDBRequest<WebChapter | undefined>
  );
  return chapter ?? null;
}

/**
 * 更新章节 (名称/内容)
 * 输入:
 *   id - 章节 ID
 *   patch - 待更新字段 (name / content)
 * 输出: Promise<void>
 * 流程:
 *   1. 读取原章节
 *   2. 合并 patch, 更新 updatedAt
 *   3. 内容变化时重新计算字数
 *   4. 写回 IndexedDB
 *   5. 同步更新所属项目的 wordCount 与 updatedAt
 */
export async function updateChapter(
  id: string,
  patch: Partial<Pick<WebChapter, "name" | "content">>
): Promise<void> {
  const existing = await getChapter(id);
  if (!existing) {
    throw new Error(`章节不存在: ${id}`);
  }
  const wordCount =
    patch.content !== undefined
      ? countWordsFromProseMirror(patch.content)
      : existing.wordCount;
  const updated: WebChapter = {
    ...existing,
    ...patch,
    wordCount,
    updatedAt: new Date().toISOString(),
  };
  await withStore(STORE_CHAPTERS, "readwrite", (store) => store.put(updated));
  // 同步更新项目字数与修改时间
  await recalcProjectWordCount(existing.projectId);
}

/**
 * 重命名章节 (updateChapter 的语义化别名)
 * 输入: id 章节 ID, name 新名称
 * 输出: Promise<void>
 */
export async function renameChapter(id: string, name: string): Promise<void> {
  await updateChapter(id, { name });
}

/**
 * 删除章节
 * 输入: id 章节 ID
 * 输出: Promise<void>
 * 流程:
 *   1. 读取章节以获取 projectId
 *   2. 删除章节
 *   3. 重新排列剩余章节的 order
 *   4. 重新计算项目字数
 */
export async function deleteChapter(id: string): Promise<void> {
  const chapter = await getChapter(id);
  if (!chapter) return;
  await withStore(STORE_CHAPTERS, "readwrite", (store) => store.delete(id));
  // 重新排列 order
  const remaining = await listChapters(chapter.projectId);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].order !== i) {
      const reordered: WebChapter = { ...remaining[i], order: i };
      await withStore(STORE_CHAPTERS, "readwrite", (store) =>
        store.put(reordered)
      );
    }
  }
  await recalcProjectWordCount(chapter.projectId);
}

// ========== 项目字数维护 ==========

/**
 * 重新计算项目总字数并更新项目记录
 * 输入: projectId 项目 ID
 * 输出: Promise<void>
 * 流程:
 *   1. 列出项目下所有章节
 *   2. 累加 wordCount
 *   3. 调用 updateProject 写回
 */
async function recalcProjectWordCount(projectId: string): Promise<void> {
  const chapters = await listChapters(projectId);
  const total = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
  await updateProject(projectId, { wordCount: total });
}

// ========== 首次访问示例数据注入 ==========

/**
 * 首次访问时注入示例项目
 * 输入: 无
 * 输出: Promise<void>
 * 流程:
 *   1. 检查 localStorage 初始化标记
 *   2. 已初始化则直接返回
 *   3. 写入示例项目与 3 章示例内容
 *   4. 设置初始化标记
 */
export async function ensureSampleData(): Promise<void> {
  if (localStorage.getItem(INIT_FLAG_KEY) === "1") return;
  // 二次校验: 防止 localStorage 被清但 IndexedDB 仍有数据
  const existing = await listProjects();
  if (existing.length > 0) {
    localStorage.setItem(INIT_FLAG_KEY, "1");
    return;
  }
  const sampleProject = getSampleProject();
  const now = new Date().toISOString();
  const project: WebProject = {
    ...sampleProject,
    createdAt: now,
    updatedAt: now,
  };
  await withStore(STORE_PROJECTS, "readwrite", (store) => store.add(project));
  const sampleChapters = getSampleChapters();
  for (let i = 0; i < sampleChapters.length; i++) {
    const sample = sampleChapters[i];
    const chapter: WebChapter = {
      id: generateId(),
      projectId: project.id,
      name: sample.name,
      content: sample.content,
      order: i,
      createdAt: now,
      updatedAt: now,
      wordCount: countWordsFromProseMirror(sample.content),
    };
    await withStore(STORE_CHAPTERS, "readwrite", (store) => store.add(chapter));
  }
  // 计算项目总字数
  await recalcProjectWordCount(project.id);
  localStorage.setItem(INIT_FLAG_KEY, "1");
}
