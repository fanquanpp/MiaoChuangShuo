// src/lib/api/graphApiFactory.ts
//
// Graph API Service 层工厂模块
// 抽取人物关系图(characterGraphApi)与剧情图谱(timelineApi)的通用 read/save/clear/buildPersisted 实现,
// 消除两份近乎一致的模板代码。所有 UI 层调用必经具体业务 API 模块, 禁止直接调用本工厂返回的方法。
//
// 设计要点:
//   1. 通过泛型 TGraph/TNode/TEdge 保证类型安全, 不使用 any/unknown;
//   2. TGraph 通过约束 `extends PersistedGraphFields<TNode, TEdge>` 锁定 nodes/edges 等基础字段,
//      既允许 saveGraph 读取节点/边数量用于诊断日志, 又允许 buildPersistedGraph 复用通用构造逻辑;
//   3. 差异点(后端命令名、错误文案、日志前缀、schemaVersion)通过 options 注入, 避免硬编码;
//   4. buildPersistedGraph 内部使用 `as TGraph` 断言, 因为 TGraph 在基类字段之外可能含有字面量类型字段
//      (例如 schemaVersion: 1), options.schemaVersion 显式传入对应值保证运行期一致。

import { invoke } from "@tauri-apps/api/core";
import { logger } from "../logger";

/**
 * 持久化图谱必须具备的基础字段结构
 * 业务图谱类型(如 CharacterGraph、TimelineGraph)可作为该结构的子类型,
 * 仅节点/边类型不同, 其余元数据字段保持一致。
 *
 * @template TNode 节点类型
 * @template TEdge 边类型
 */
export interface PersistedGraphFields<TNode, TEdge> {
  /** 文件格式版本(用于未来迁移) */
  schemaVersion: number;
  /** 项目唯一标识(取自项目路径, 用于内部关联) */
  projectId: string;
  /** 项目名称(冗余字段, 便于离线识别) */
  projectName: string;
  /** 最后修改时间 ISO 8601 */
  updatedAt: string;
  /** 节点列表(包含位置信息, 与 React Flow nodes 一一对应) */
  nodes: TNode[];
  /** 边列表 */
  edges: TEdge[];
}

/**
 * Graph API 工厂配置项
 * 描述具体业务图谱与后端命令之间的差异点, 由工厂生成对应方法集。
 * 配置字段均为运行期数据, 不依赖业务泛型, 因此接口本身不带泛型参数。
 */
export interface GraphApiOptions {
  /** 读取图谱的 Tauri 命令名, 例如 "read_character_graph" */
  readCommand: string;
  /** 保存图谱的 Tauri 命令名, 例如 "save_character_graph" */
  saveCommand: string;
  /** 清空图谱的 Tauri 命令名, 例如 "clear_character_graph" */
  clearCommand: string;
  /** 错误日志前缀, 例如 "[CharacterGraph]", 便于在控制台过滤 */
  logPrefix: string;
  /** 业务领域名称, 用于错误信息文案, 例如 "人物关系图" / "剧情图谱" */
  domainLabel: string;
  /**
   * 持久化 schema 版本号, 与 TGraph.schemaVersion 字面量值保持一致。
   * 类型为 number, 调用方传入字面量(如 1)时由 TypeScript 自动收窄,
   * buildPersistedGraph 内部通过 `as TGraph` 断言将返回值类型对齐业务类型。
   */
  schemaVersion: number;
}

/**
 * Graph API 工厂返回的通用方法集
 * 工厂生成的 read/save/clear/buildPersistedGraph 方法已封装 Tauri invoke 调用与统一错误处理。
 *
 * @template TGraph 业务图谱类型
 * @template TNode  节点类型
 * @template TEdge  边类型
 */
export interface GraphApi<TGraph, TNode, TEdge> {
  /** 读取项目图谱(不存在时返回空图谱) */
  readGraph: (projectRoot: string) => Promise<TGraph>;
  /** 保存图谱(自动生成 txt 摘要) */
  saveGraph: (projectRoot: string, graph: TGraph) => Promise<void>;
  /** 清空图谱(含目录删除, 前端需二次确认) */
  clearGraph: (projectRoot: string) => Promise<void>;
  /** 从 React Flow nodes/edges 数组构造持久化图谱结构 */
  buildPersistedGraph: (
    nodes: TNode[],
    edges: TEdge[],
    projectRoot: string,
    projectName: string
  ) => TGraph;
}

/**
 * 创建 Graph API 工厂函数
 * 消除 characterGraphApi 与 timelineApi 的重复 read/save/clear/buildPersisted 实现。
 *
 * 输入参数:
 *   options 工厂配置项, 包含后端命令名、错误文案、日志前缀、schemaVersion 等
 * 返回值:
 *   GraphApi 通用方法集, 由具体业务 API 模块进一步包装为具名导出
 * 核心流程:
 *   1. 解构 options 取得命令名与文案配置;
 *   2. 闭包生成 readGraph/saveGraph/clearGraph/buildPersistedGraph 四个方法;
 *   3. readGraph/saveGraph/clearGraph 通过 try-catch 包裹 invoke 调用并按 domainLabel 拼装错误信息;
 *   4. saveGraph 额外输出结构化日志, 便于排查后端反序列化/IO/权限问题;
 *   5. buildPersistedGraph 复用通用字段构造, 通过 options.schemaVersion 保证与 TGraph 字面量值一致。
 *
 * @template TGraph 业务图谱类型, 必须满足 PersistedGraphFields<TNode, TEdge> 约束
 * @template TNode  节点类型
 * @template TEdge  边类型
 */
export function createGraphApi<
  TGraph extends PersistedGraphFields<TNode, TEdge>,
  TNode,
  TEdge
>(options: GraphApiOptions): GraphApi<TGraph, TNode, TEdge> {
  const {
    readCommand,
    saveCommand,
    clearCommand,
    logPrefix,
    domainLabel,
    schemaVersion,
  } = options;

  /**
   * 读取项目图谱
   * 输入: projectRoot 项目根路径(同时作为 projectId)
   * 输出: Promise<TGraph> 图谱数据(不存在时返回空图谱)
   * 流程: 调用 Tauri read 命令, 统一错误处理
   */
  async function readGraph(projectRoot: string): Promise<TGraph> {
    try {
      return await invoke<TGraph>(readCommand, { projectRoot });
    } catch (err) {
      throw new Error(`读取${domainLabel}失败: ${String(err)}`);
    }
  }

  /**
   * 保存图谱(自动生成 txt 摘要)
   * 输入: projectRoot 项目根路径, graph 图谱数据
   * 输出: Promise<void>
   * 流程: 调用 Tauri save 命令(含数据校验与原子写入)
   * 错误诊断: 捕获完整错误对象并输出结构化日志, 便于排查后端反序列化/IO/权限问题
   */
  async function saveGraph(projectRoot: string, graph: TGraph): Promise<void> {
    try {
      await invoke(saveCommand, { projectRoot, graph });
    } catch (err) {
      // 结构化错误日志: 输出命令名/项目路径/图谱字段键/完整错误对象
      // 便于快速定位是 "command not found" 还是 "missing field xxx" 还是 IO 错误
      logger.error(`${logPrefix} 保存失败详情:`, {
        command: saveCommand,
        projectRoot,
        graphKeys: Object.keys(graph),
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        error: err instanceof Error ? err : String(err),
        errorType: typeof err,
        errorString: String(err),
      });
      throw new Error(`保存${domainLabel}失败: ${String(err)}`);
    }
  }

  /**
   * 清空图谱(含目录删除)
   * 输入: projectRoot 项目根路径
   * 输出: Promise<void>
   * 流程: 调用 Tauri clear 命令(前端需二次确认)
   */
  async function clearGraph(projectRoot: string): Promise<void> {
    try {
      await invoke(clearCommand, { projectRoot });
    } catch (err) {
      throw new Error(`清空${domainLabel}失败: ${String(err)}`);
    }
  }

  /**
   * 从 React Flow nodes/edges 数组构造持久化图谱结构
   * 输入: nodes React Flow 节点, edges React Flow 边,
   *       projectRoot 项目根路径(作为 projectId), projectName 项目名
   * 输出: TGraph 持久化数据
   * 流程: 提取节点位置与业务数据, 组装为后端可序列化结构
   *
   * 类型说明: TGraph extends PersistedGraphFields<TNode, TEdge> 保证返回对象满足基础字段,
   *   由于 TGraph 可能含字面量类型字段(如 schemaVersion: 1), 此处使用 `as TGraph` 断言。
   *   options.schemaVersion 由调用方按业务类型字面量值传入, 保证运行期值与静态类型共同正确。
   */
  function buildPersistedGraph(
    nodes: TNode[],
    edges: TEdge[],
    projectRoot: string,
    projectName: string
  ): TGraph {
    return {
      schemaVersion,
      projectId: projectRoot,
      projectName,
      updatedAt: new Date().toISOString(),
      nodes,
      edges,
    } as TGraph;
  }

  return {
    readGraph,
    saveGraph,
    clearGraph,
    buildPersistedGraph,
  };
}
