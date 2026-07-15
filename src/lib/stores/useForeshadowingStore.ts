// 伏笔追踪模块 Service 层状态管理
//
// 功能概述:
// 使用 Zustand 管理伏笔追踪模块的前端状态,作为 ForeshadowingPanel 等 UI 组件的统一数据源。
// 数据 SSOT 在后端(<project>/伏笔/foreshadowings.json),前端 store 仅作为内存缓存,
// 因此不使用 persist 中间件,项目切换时通过 reset 清空。
//
// 模块职责:
//   1. 维护 foreshadowings 数组与 loading/error 状态
//   2. 提供 fetchList / create / update / remove 四个 Action
//   3. Action 内部封装 API 调用与内存状态同步,异常通过 error 字段暴露给 UI

import { create } from "zustand";
import {
  listForeshadowings,
  createForeshadowing,
  updateForeshadowing,
  deleteForeshadowing,
  type Foreshadowing,
  type ForeshadowingStatus,
  type ForeshadowingImportance,
} from "../api/foreshadowingApi";

/**
 * 新建伏笔时传入的载荷类型
 * 仅包含业务可编辑字段,id/createdAt/updatedAt 由后端生成
 */
export interface ForeshadowingInput {
  title: string;
  status: ForeshadowingStatus;
  setupChapterId: string | null;
  resolutionChapterId: string | null;
  importance: ForeshadowingImportance;
  note: string;
}

/**
 * 伏笔 Store 状态接口
 */
interface ForeshadowingState {
  /** 伏笔列表(按后端持久化顺序) */
  foreshadowings: Foreshadowing[];
  /** 加载中标记(列表请求期间为 true,UI 显示骨架/加载态) */
  loading: boolean;
  /** 最近一次操作的错误信息(null 表示无错误,UI 可用于 toast 提示) */
  error: string | null;

  /**
   * 拉取项目下所有伏笔
   * 输入: projectPath 项目根路径
   * 输出: Promise<void>
   * 流程:
   *   1. 设置 loading = true,清空旧 error
   *   2. 调用 API 获取列表,更新 state
   *   3. 失败时设置 error 字段
   *   4. finally 阶段重置 loading = false
   */
  fetchList: (projectPath: string) => Promise<void>;

  /**
   * 新建伏笔
   * 输入:
   *   projectPath 项目根路径
   *   input 业务字段
   * 输出: Promise<Foreshadowing> 创建后的伏笔对象(含后端生成的 id)
   * 流程:
   *   1. 调用 API 创建伏笔
   *   2. 成功后追加到内存列表末尾
   *   3. 失败时设置 error 并抛出,交由调用方处理
   */
  create: (projectPath: string, input: ForeshadowingInput) => Promise<Foreshadowing>;

  /**
   * 更新伏笔
   * 输入:
   *   projectPath 项目根路径
   *   foreshadowing 待更新的伏笔对象(需含 id)
   * 输出: Promise<void>
   * 流程:
   *   1. 调用 API 更新伏笔
   *   2. 成功后用后端返回的字段(updatedAt 等)替换内存列表中同 id 条目
   *   3. 失败时设置 error 并抛出
   */
  update: (projectPath: string, foreshadowing: Foreshadowing) => Promise<void>;

  /**
   * 删除伏笔
   * 输入:
   *   projectPath 项目根路径
   *   foreshadowingId 待删除伏笔的 UUID
   * 输出: Promise<void>
   * 流程:
   *   1. 调用 API 删除伏笔
   *   2. 成功后从内存列表过滤移除目标条目
   *   3. 失败时设置 error 并抛出
   */
  remove: (projectPath: string, foreshadowingId: string) => Promise<void>;

  /**
   * 重置 Store(项目切换时调用)
   * 流程: 清空列表与 error,重置 loading 状态
   */
  reset: () => void;
}

/**
 * 创建伏笔全局 Store
 * 命名遵循 useAppStore 模式(use + Store 后缀)
 * 不使用 persist:数据 SSOT 在后端文件,localStorage 缓存无意义且易导致脏读
 */
export const useForeshadowingStore = create<ForeshadowingState>()((set) => ({
  foreshadowings: [],
  loading: false,
  error: null,

  fetchList: async (projectPath: string): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const list = await listForeshadowings(projectPath);
      set({ foreshadowings: list, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  create: async (projectPath: string, input: ForeshadowingInput): Promise<Foreshadowing> => {
    try {
      const created = await createForeshadowing(projectPath, input);
      set((state) => ({
        foreshadowings: [...state.foreshadowings, created],
        error: null,
      }));
      return created;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg });
      throw new Error(msg);
    }
  },

  update: async (projectPath: string, foreshadowing: Foreshadowing): Promise<void> => {
    try {
      await updateForeshadowing(projectPath, foreshadowing);
      // 后端已强制更新 updatedAt,本地用传入对象的副本即可
      // 注:此处不重新读取列表,调用方传入的对象应反映最新状态
      set((state) => ({
        foreshadowings: state.foreshadowings.map((item) =>
          item.id === foreshadowing.id ? { ...foreshadowing } : item,
        ),
        error: null,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg });
      throw new Error(msg);
    }
  },

  remove: async (projectPath: string, foreshadowingId: string): Promise<void> => {
    try {
      await deleteForeshadowing(projectPath, foreshadowingId);
      set((state) => ({
        foreshadowings: state.foreshadowings.filter((item) => item.id !== foreshadowingId),
        error: null,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg });
      throw new Error(msg);
    }
  },

  reset: (): void => {
    set({ foreshadowings: [], loading: false, error: null });
  },
}));
