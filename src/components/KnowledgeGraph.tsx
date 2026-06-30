// 知识图谱组件（Obsidian 风格力导向图）
//
// 功能概述：
// 使用 HTML Canvas 渲染小说项目的知识图谱，展示角色、世界观、名词之间的关联关系。
// 采用弹簧-库仑力模型实现力导向布局，支持平移、缩放、悬停高亮、节点拖拽和点击导航。
//
// 模块职责：
// 1. 从项目目录树加载角色/世界观/名词卡片数据
// 2. 通过文本交叉引用提取卡片间的关联边
// 3. 运行力导向物理模拟并渲染到 Canvas
// 4. 支持平移（拖拽背景）、缩放（滚轮）、悬停高亮、节点拖拽固定、点击导航到卡片
// 5. HTML 覆盖层渲染图例（清晰不模糊）和重置按钮

import { useRef, useEffect, useState, useCallback } from "react";
import { useAppStore, CATEGORY_DIRS } from "../lib/store";
import { readFile } from "../lib/api";
import type { FileNode } from "../lib/api";
import { findDirByName } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";

// ===== 类型定义 =====

// 图谱节点分类（仅包含知识图谱展示的三大分类）
type GraphCategory = "characters" | "worldview" | "glossary";

// 图谱节点接口
interface GraphNode {
  id: string;                  // 唯一标识（使用文件相对路径）
  label: string;               // 显示标签（文件名去扩展名）
  category: GraphCategory;     // 所属分类
  x: number;                   // 当前 X 坐标
  y: number;                   // 当前 Y 坐标
  vx: number;                  // X 方向速度
  vy: number;                  // Y 方向速度
  filePath: string;            // 文件相对路径（用于导航定位）
  pinned: boolean;             // 是否被用户固定（拖拽后固定）
}

// 图谱边接口
interface GraphEdge {
  source: string;  // 源节点 ID
  target: string;  // 目标节点 ID
}

// ===== 物理模拟常量 =====

const REPULSION_STRENGTH = 4000;    // 库仑斥力强度
const SPRING_STRENGTH = 0.004;      // 弹簧引力系数
const SPRING_REST_LENGTH = 160;     // 弹簧自然长度（像素）
const CENTER_GRAVITY = 0.008;       // 中心引力系数
const VELOCITY_DAMPING = 0.82;      // 速度衰减因子（每帧乘以该值）
const MIN_VELOCITY = 0.01;          // 最小速度阈值（低于此值视为静止）
const MAX_VELOCITY = 8;             // 最大速度限制（防止爆炸）
const NODE_RADIUS = 18;             // 节点半径（像素）
const LABEL_MAX_LENGTH = 10;        // 标签最大字符数（超出截断加省略号）
const HOVER_RADIUS_FACTOR = 1.5;    // 悬停检测半径放大系数
const EDGE_CURVE_OFFSET = 20;       // 边弯曲偏移量

// ===== 辅助函数 =====

/**
 * 从目录树中收集指定分类目录下所有 .txt 文件节点
 */
function collectFilesFromDir(
  dirNode: FileNode | null,
  category: GraphCategory
): { label: string; filePath: string; category: GraphCategory }[] {
  if (!dirNode || !dirNode.is_dir) return [];
  const results: { label: string; filePath: string; category: GraphCategory }[] = [];
  for (const child of dirNode.children) {
    if (!child.is_dir && child.name.endsWith(".txt")) {
      const label = child.name.replace(/\.txt$/i, "");
      results.push({ label, filePath: child.relative_path, category });
    }
  }
  return results;
}

/**
 * 截断标签文本，超出最大长度时添加省略号
 */
function truncateLabel(label: string, maxLen: number): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen) + "\u2026";
}

/**
 * 限制速度在合理范围内（防止力计算导致速度爆炸）
 */
function clampVelocity(v: number): number {
  if (Math.abs(v) < MIN_VELOCITY) return 0;
  return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v));
}

/**
 * 获取 CSS 自定义属性的计算值（适配亮/暗主题）
 */
function getCSSColor(varName: string): string {
  const styles = getComputedStyle(document.documentElement);
  return styles.getPropertyValue(varName).trim();
}

/**
 * 将 hex 颜色转为 rgba 字符串
 */
function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ===== 主组件 =====

export default function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  // 从全局 store 获取项目状态
  const currentProject = useAppStore((s) => s.currentProject);
  const projectTree = useAppStore((s) => s.projectTree);
  const navigateToFile = useAppStore((s) => s.navigateToFile);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);

  const { t } = useI18n();

  // 图谱数据状态
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);

  // 交互状态（使用 ref 以避免动画循环中的闭包陷阱）
  const hoveredNodeRef = useRef<GraphNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // 视图变换状态（平移和缩放）
  const viewTransformRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });

  // 拖拽状态（背景平移 + 节点拖拽）
  const dragStateRef = useRef({
    isDragging: false,
    isDraggingNode: false,
    draggedNode: null as GraphNode | null,
    lastX: 0,
    lastY: 0,
    hasMoved: false, // 判断是否发生了拖拽（区分点击和拖拽）
  });

  // 节点数据引用（物理模拟直接修改，避免频繁 setState）
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);

  // 模拟是否已趋于稳定（减少不必要的重绘）
  const simulationActiveRef = useRef(true);

  // 用于强制刷新图例中的计数
  const [graphStats, setGraphStats] = useState({ nodeCount: 0, edgeCount: 0 });

  // ===== 数据加载 =====

  useEffect(() => {
    if (!currentProject || projectTree.length === 0) {
      setNodes([]);
      setEdges([]);
      nodesRef.current = [];
      edgesRef.current = [];
      setGraphStats({ nodeCount: 0, edgeCount: 0 });
      return;
    }

    let cancelled = false;

    async function loadGraphData() {
      setLoading(true);

      try {
        const projectPath = currentProject!.path;
        const tree = projectTree;

        // 查找三大分类目录节点
        const charDir = findDirByName(tree, CATEGORY_DIRS.characters);
        const worldDir = findDirByName(tree, CATEGORY_DIRS.worldview);
        const glossDir = findDirByName(tree, CATEGORY_DIRS.glossary);

        // 收集各分类下的文件信息
        const allFiles: { label: string; filePath: string; category: GraphCategory }[] = [
          ...collectFilesFromDir(charDir, "characters"),
          ...collectFilesFromDir(worldDir, "worldview"),
          ...collectFilesFromDir(glossDir, "glossary"),
        ];

        if (cancelled || allFiles.length === 0) {
          if (!cancelled) {
            setNodes([]);
            setEdges([]);
            nodesRef.current = [];
            edgesRef.current = [];
            setGraphStats({ nodeCount: 0, edgeCount: 0 });
            setLoading(false);
          }
          return;
        }

        // 读取所有卡片文件内容，用于交叉引用检测
        const fileContents = new Map<string, string>();
        const readPromises = allFiles.map(async (f) => {
          try {
            const absPath = `${projectPath}/${f.filePath}`;
            const content = await readFile(absPath, projectPath);
            fileContents.set(f.filePath, content);
          } catch {
            // 读取失败时跳过该文件，不影响整体图谱
            fileContents.set(f.filePath, "");
          }
        });
        await Promise.all(readPromises);

        if (cancelled) return;

        // 构建节点（初始位置随机分布在画布中心附近）
        const canvasEl = canvasRef.current;
        const cx = canvasEl ? canvasEl.width / 2 : 400;
        const cy = canvasEl ? canvasEl.height / 2 : 300;
        const spreadRadius = Math.min(cx, cy) * 0.6;

        const newNodes: GraphNode[] = allFiles.map((f, i) => {
          const angle = (2 * Math.PI * i) / allFiles.length;
          const r = spreadRadius * (0.3 + Math.random() * 0.7);
          return {
            id: f.filePath,
            label: f.label,
            category: f.category,
            x: cx + r * Math.cos(angle) + (Math.random() - 0.5) * 50,
            y: cy + r * Math.sin(angle) + (Math.random() - 0.5) * 50,
            vx: 0,
            vy: 0,
            filePath: f.filePath,
            pinned: false,
          };
        });

        // 构建边（通过交叉引用检测：A 的内容中提到了 B 的名字）
        const allLabels = allFiles.map((f) => f.label);
        const labelToId = new Map<string, string>();
        allFiles.forEach((f) => labelToId.set(f.label, f.filePath));

        const edgeSet = new Set<string>(); // 去重用的 "source|target" 集合
        const newEdges: GraphEdge[] = [];

        for (const file of allFiles) {
          const content = fileContents.get(file.filePath) || "";
          if (!content) continue;

          for (const otherLabel of allLabels) {
            // 跳过自身引用
            if (otherLabel === file.label) continue;
            // 检查文件内容是否包含其他卡片的名称
            if (content.includes(otherLabel)) {
              const sourceId = file.filePath;
              const targetId = labelToId.get(otherLabel)!;
              // 无向边去重：统一按字典序排列
              const edgeKey =
                sourceId < targetId
                  ? `${sourceId}|${targetId}`
                  : `${targetId}|${sourceId}`;
              if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);
                newEdges.push({ source: sourceId, target: targetId });
              }
            }
          }
        }

        if (cancelled) return;

        // 更新状态
        nodesRef.current = newNodes;
        edgesRef.current = newEdges;
        setNodes(newNodes);
        setEdges(newEdges);
        setGraphStats({ nodeCount: newNodes.length, edgeCount: newEdges.length });
        simulationActiveRef.current = true;

        // 重置视图变换，居中显示
        viewTransformRef.current = { offsetX: 0, offsetY: 0, scale: 1 };
      } catch (err) {
        console.error("[KnowledgeGraph] 加载图谱数据失败:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGraphData();

    return () => {
      cancelled = true;
    };
  }, [currentProject, projectTree]);

  // ===== 力导向物理模拟与 Canvas 渲染 =====

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 构建节点 ID 到索引的映射（加速物理模拟中的查找）
    function buildNodeIndex(nodeList: GraphNode[]): Map<string, number> {
      const map = new Map<string, number>();
      nodeList.forEach((n, i) => map.set(n.id, i));
      return map;
    }

    /**
     * 执行一步物理模拟：
     * 1. 所有节点对之间施加库仑斥力
     * 2. 沿边施加弹簧引力
     * 3. 施加向画布中心的引力
     * 4. 衰减速度并更新位置（跳过被固定的节点）
     */
    function simulationStep(
      nodeList: GraphNode[],
      edgeList: GraphEdge[],
      nodeIndex: Map<string, number>,
      centerX: number,
      centerY: number
    ): boolean {
      let totalKineticEnergy = 0;

      // --- 库仑斥力：所有节点对之间相互排斥 ---
      for (let i = 0; i < nodeList.length; i++) {
        for (let j = i + 1; j < nodeList.length; j++) {
          const ni = nodeList[i];
          const nj = nodeList[j];
          let dx = ni.x - nj.x;
          let dy = ni.y - nj.y;
          let distSq = dx * dx + dy * dy;
          // 防止距离过近导致力爆炸
          if (distSq < 1) distSq = 1;
          const dist = Math.sqrt(distSq);
          const force = REPULSION_STRENGTH / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (!ni.pinned) { ni.vx += fx; ni.vy += fy; }
          if (!nj.pinned) { nj.vx -= fx; nj.vy -= fy; }
        }
      }

      // --- 弹簧引力：沿边拉近相连节点 ---
      for (const edge of edgeList) {
        const si = nodeIndex.get(edge.source);
        const ti = nodeIndex.get(edge.target);
        if (si === undefined || ti === undefined) continue;
        const ns = nodeList[si];
        const nt = nodeList[ti];
        const dx = nt.x - ns.x;
        const dy = nt.y - ns.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const displacement = dist - SPRING_REST_LENGTH;
        const force = SPRING_STRENGTH * displacement;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!ns.pinned) { ns.vx += fx; ns.vy += fy; }
        if (!nt.pinned) { nt.vx -= fx; nt.vy -= fy; }
      }

      // --- 中心引力 + 速度衰减 + 位置更新 ---
      for (const node of nodeList) {
        if (node.pinned) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        // 向中心拉拽，防止节点飘散
        node.vx += (centerX - node.x) * CENTER_GRAVITY;
        node.vy += (centerY - node.y) * CENTER_GRAVITY;

        // 衰减速度
        node.vx *= VELOCITY_DAMPING;
        node.vy *= VELOCITY_DAMPING;

        // 限制速度范围
        node.vx = clampVelocity(node.vx);
        node.vy = clampVelocity(node.vy);

        // 更新位置
        node.x += node.vx;
        node.y += node.vy;

        // 累计动能，用于判断是否趋于稳定
        totalKineticEnergy += node.vx * node.vx + node.vy * node.vy;
      }

      // 当总动能低于阈值时认为模拟已稳定
      return totalKineticEnergy > 0.5;
    }

    /**
     * 渲染一帧：清空画布、绘制边（弯曲+渐变）、绘制节点（发光效果）、绘制标签
     */
    function render() {
      if (!canvas || !ctx) return;

      const nodeList = nodesRef.current;
      const edgeList = edgesRef.current;
      const transform = viewTransformRef.current;
      const hovered = hoveredNodeRef.current;

      const width = canvas.width;
      const height = canvas.height;

      // 获取主题颜色（每次渲染重新获取，以响应主题切换）
      const primaryColor = getCSSColor("--fandex-primary") || "#6366f1";
      const secondaryColor = getCSSColor("--fandex-secondary") || "#10b981";
      const tertiaryColor = getCSSColor("--fandex-tertiary") || "#f59e0b";
      const bgColor = getCSSColor("--fandex-bg") || "#0f172a";
      const textColor = getCSSColor("--fandex-text") || "#e2e8f0";
      const borderColor = getCSSColor("--fandex-border") || "#334155";

      // 分类到颜色的映射
      const categoryColors: Record<GraphCategory, string> = {
        characters: primaryColor,
        worldview: secondaryColor,
        glossary: tertiaryColor,
      };

      // 清空画布
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      // 应用视图变换（平移 + 缩放）
      ctx.save();
      ctx.translate(transform.offsetX, transform.offsetY);
      ctx.scale(transform.scale, transform.scale);

      // 构建节点索引（用于边绘制时快速查找坐标）
      const nodeMap = new Map<string, GraphNode>();
      for (const n of nodeList) nodeMap.set(n.id, n);

      // 预计算悬停连接集合（加速渲染判断）
      const connectedNodeIds = new Set<string>();
      const highlightedEdgeKeys = new Set<string>();
      if (hovered) {
        connectedNodeIds.add(hovered.id);
        for (const edge of edgeList) {
          if (edge.source === hovered.id || edge.target === hovered.id) {
            connectedNodeIds.add(edge.source);
            connectedNodeIds.add(edge.target);
            const key = edge.source < edge.target
              ? `${edge.source}|${edge.target}`
              : `${edge.target}|${edge.source}`;
            highlightedEdgeKeys.add(key);
          }
        }
      }

      // --- 绘制边（弯曲 + 渐变透明度） ---
      for (const edge of edgeList) {
        const ns = nodeMap.get(edge.source);
        const nt = nodeMap.get(edge.target);
        if (!ns || !nt) continue;

        const edgeKey = edge.source < edge.target
          ? `${edge.source}|${edge.target}`
          : `${edge.target}|${edge.source}`;
        const isHighlighted = highlightedEdgeKeys.has(edgeKey);

        // 有悬停时，非相关边淡出
        if (hovered && !isHighlighted) {
          ctx.globalAlpha = 0.08;
        } else if (isHighlighted) {
          ctx.globalAlpha = 0.9;
        } else {
          ctx.globalAlpha = 0.3;
        }

        // 计算曲线控制点（在两节点连线中点垂直偏移）
        const mx = (ns.x + nt.x) / 2;
        const my = (ns.y + nt.y) / 2;
        const dx = nt.x - ns.x;
        const dy = nt.y - ns.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // 法线方向偏移
        const nx = -dy / dist;
        const ny = dx / dist;
        const cpx = mx + nx * EDGE_CURVE_OFFSET;
        const cpy = my + ny * EDGE_CURVE_OFFSET;

        // 创建沿边的渐变
        const sourceColor = categoryColors[ns.category];
        const targetColor = categoryColors[nt.category];

        const gradient = ctx.createLinearGradient(ns.x, ns.y, nt.x, nt.y);
        if (isHighlighted) {
          gradient.addColorStop(0, hexToRgba(sourceColor, 0.9));
          gradient.addColorStop(0.5, hexToRgba(textColor, 0.7));
          gradient.addColorStop(1, hexToRgba(targetColor, 0.9));
        } else {
          gradient.addColorStop(0, hexToRgba(sourceColor, 0.5));
          gradient.addColorStop(0.5, hexToRgba(borderColor, 0.3));
          gradient.addColorStop(1, hexToRgba(targetColor, 0.5));
        }

        ctx.beginPath();
        ctx.moveTo(ns.x, ns.y);
        ctx.quadraticCurveTo(cpx, cpy, nt.x, nt.y);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = isHighlighted ? 2.5 / transform.scale : 1.2 / transform.scale;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // --- 绘制节点（发光效果） ---
      for (const node of nodeList) {
        const color = categoryColors[node.category];
        const isHovered = hovered && hovered.id === node.id;
        const isConnected = hovered && connectedNodeIds.has(node.id) && !isHovered;

        const baseRadius = NODE_RADIUS;
        const radius = isHovered
          ? baseRadius * 1.35
          : isConnected
          ? baseRadius * 1.1
          : baseRadius;

        // 悬停或连接节点以外的节点在有悬停时半透明显示
        if (hovered && !isHovered && !isConnected) {
          ctx.globalAlpha = 0.2;
        } else {
          ctx.globalAlpha = 1;
        }

        // 外发光效果
        const glowRadius = isHovered ? 20 : isConnected ? 10 : 6;
        ctx.shadowColor = color;
        ctx.shadowBlur = glowRadius;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // 绘制节点圆形
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);

        // 径向渐变填充（从亮到暗）
        const nodeGradient = ctx.createRadialGradient(
          node.x - radius * 0.3, node.y - radius * 0.3, radius * 0.1,
          node.x, node.y, radius
        );
        nodeGradient.addColorStop(0, hexToRgba(color, 1));
        nodeGradient.addColorStop(0.7, color);
        nodeGradient.addColorStop(1, hexToRgba(color, 0.7));
        ctx.fillStyle = nodeGradient;
        ctx.fill();

        // 清除阴影后再描边
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        // 节点描边
        if (isHovered) {
          ctx.strokeStyle = textColor;
          ctx.lineWidth = 2.5 / transform.scale;
        } else if (node.pinned) {
          // 固定的节点用白色虚线描边标识
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 2 / transform.scale;
          ctx.setLineDash([3 / transform.scale, 3 / transform.scale]);
        } else {
          ctx.strokeStyle = "rgba(255,255,255,0.15)";
          ctx.lineWidth = 1 / transform.scale;
        }
        ctx.stroke();
        ctx.setLineDash([]); // 重置虚线

        ctx.globalAlpha = 1;
      }

      // --- 绘制节点标签 ---
      const fontSize = Math.max(10, 12 / transform.scale);
      ctx.font = `500 ${fontSize}px "Inter", "Noto Sans SC", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      for (const node of nodeList) {
        const isHovered = hovered && hovered.id === node.id;
        const isConnected = hovered && connectedNodeIds.has(node.id) && !isHovered;

        // 有悬停时，仅显示悬停节点及其相邻节点的标签
        if (hovered && !isHovered && !isConnected) {
          ctx.globalAlpha = 0.1;
        } else {
          ctx.globalAlpha = 0.95;
        }

        const displayLabel = truncateLabel(node.label, LABEL_MAX_LENGTH);
        const labelY = node.y + NODE_RADIUS + 5;

        // 标签背景（提升可读性）
        const metrics = ctx.measureText(displayLabel);
        const padding = 4;
        const bgAlpha = hovered && !isHovered && !isConnected ? 0.3 : 0.7;
        ctx.fillStyle = bgColor;
        ctx.globalAlpha = ctx.globalAlpha * bgAlpha;

        // 圆角背景
        const bgX = node.x - metrics.width / 2 - padding;
        const bgY = labelY - 2;
        const bgW = metrics.width + padding * 2;
        const bgH = fontSize + padding * 2;
        const bgR = 3;
        ctx.beginPath();
        ctx.moveTo(bgX + bgR, bgY);
        ctx.lineTo(bgX + bgW - bgR, bgY);
        ctx.arcTo(bgX + bgW, bgY, bgX + bgW, bgY + bgR, bgR);
        ctx.lineTo(bgX + bgW, bgY + bgH - bgR);
        ctx.arcTo(bgX + bgW, bgY + bgH, bgX + bgW - bgR, bgY + bgH, bgR);
        ctx.lineTo(bgX + bgR, bgY + bgH);
        ctx.arcTo(bgX, bgY + bgH, bgX, bgY + bgH - bgR, bgR);
        ctx.lineTo(bgX, bgY + bgR);
        ctx.arcTo(bgX, bgY, bgX + bgR, bgY, bgR);
        ctx.closePath();
        ctx.fill();

        // 标签文本
        if (hovered && !isHovered && !isConnected) {
          ctx.globalAlpha = 0.1;
        } else {
          ctx.globalAlpha = 0.95;
        }
        ctx.fillStyle = textColor;
        ctx.fillText(displayLabel, node.x, labelY + padding);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    // ===== 动画主循环 =====

    function animate() {
      if (!canvas || !ctx) return;

      const nodeList = nodesRef.current;
      const edgeList = edgesRef.current;

      if (nodeList.length > 0) {
        const nodeIndex = buildNodeIndex(nodeList);
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        // 执行物理模拟步骤
        if (simulationActiveRef.current) {
          const isActive = simulationStep(nodeList, edgeList, nodeIndex, centerX, centerY);
          simulationActiveRef.current = isActive;
        }
      }

      // 渲染当前帧
      render();

      // 请求下一帧
      animFrameRef.current = requestAnimationFrame(animate);
    }

    // 启动动画循环
    animFrameRef.current = requestAnimationFrame(animate);

    // 组件卸载时取消动画
    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [t]); // 仅当翻译函数变化时重新启动循环（极少发生）

  // ===== Canvas 尺寸自适应 =====

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleResize() {
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      // 触发一轮模拟以重新居中
      simulationActiveRef.current = true;
    }

    handleResize();

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas.parentElement!);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // ===== 鼠标交互：平移、缩放、悬停、节点拖拽、点击 =====

  /**
   * 将屏幕坐标转换为图谱坐标（应用视图逆变换）
   */
  const screenToGraph = useCallback((screenX: number, screenY: number) => {
    const transform = viewTransformRef.current;
    return {
      x: (screenX - transform.offsetX) / transform.scale,
      y: (screenY - transform.offsetY) / transform.scale,
    };
  }, []);

  /**
   * 在指定图谱坐标处查找被悬停的节点
   */
  const findNodeAt = useCallback((graphX: number, graphY: number): GraphNode | null => {
    const nodeList = nodesRef.current;
    const hitRadius = NODE_RADIUS * HOVER_RADIUS_FACTOR;
    for (let i = nodeList.length - 1; i >= 0; i--) {
      const n = nodeList[i];
      const dx = graphX - n.x;
      const dy = graphY - n.y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return n;
      }
    }
    return null;
  }, []);

  // 鼠标按下：检测是节点拖拽还是背景平移
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const graphPos = screenToGraph(mouseX, mouseY);
    const node = findNodeAt(graphPos.x, graphPos.y);

    if (node) {
      // 开始拖拽节点
      dragStateRef.current = {
        isDragging: false,
        isDraggingNode: true,
        draggedNode: node,
        lastX: e.clientX,
        lastY: e.clientY,
        hasMoved: false,
      };
      canvas.style.cursor = "grabbing";
    } else {
      // 开始平移背景
      dragStateRef.current = {
        isDragging: true,
        isDraggingNode: false,
        draggedNode: null,
        lastX: e.clientX,
        lastY: e.clientY,
        hasMoved: false,
      };
      canvas.style.cursor = "grabbing";
    }
  }, [screenToGraph, findNodeAt]);

  // 鼠标移动：拖拽平移 + 节点拖拽 + 悬停检测
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (dragStateRef.current.isDraggingNode && dragStateRef.current.draggedNode) {
        // 拖拽节点：更新节点位置到鼠标所在图谱坐标
        const graphPos = screenToGraph(mouseX, mouseY);
        const node = dragStateRef.current.draggedNode;
        node.x = graphPos.x;
        node.y = graphPos.y;
        node.vx = 0;
        node.vy = 0;
        dragStateRef.current.hasMoved = true;
        // 拖拽时重新激活模拟让其他节点响应
        simulationActiveRef.current = true;
        return;
      }

      if (dragStateRef.current.isDragging) {
        // 平移视图
        const dx = e.clientX - dragStateRef.current.lastX;
        const dy = e.clientY - dragStateRef.current.lastY;
        viewTransformRef.current.offsetX += dx;
        viewTransformRef.current.offsetY += dy;
        dragStateRef.current.lastX = e.clientX;
        dragStateRef.current.lastY = e.clientY;
        dragStateRef.current.hasMoved = true;
        return;
      }

      // 悬停检测
      const graphPos = screenToGraph(mouseX, mouseY);
      const node = findNodeAt(graphPos.x, graphPos.y);
      const newHoveredId = node ? node.id : null;

      if (newHoveredId !== hoveredNodeRef.current?.id) {
        hoveredNodeRef.current = node;
        setHoveredNodeId(newHoveredId);
        // 更新鼠标样式
        canvas.style.cursor = node ? "pointer" : "grab";
      }
    },
    [screenToGraph, findNodeAt]
  );

  // 鼠标释放：结束拖拽，固定被拖拽的节点
  const handleMouseUp = useCallback(() => {
    if (dragStateRef.current.isDraggingNode && dragStateRef.current.draggedNode) {
      // 固定被拖拽的节点
      if (dragStateRef.current.hasMoved) {
        dragStateRef.current.draggedNode.pinned = true;
        dragStateRef.current.draggedNode.vx = 0;
        dragStateRef.current.draggedNode.vy = 0;
      }
    }
    dragStateRef.current.isDragging = false;
    dragStateRef.current.isDraggingNode = false;
    dragStateRef.current.draggedNode = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const hovered = hoveredNodeRef.current;
      canvas.style.cursor = hovered ? "pointer" : "grab";
    }
  }, []);

  // 鼠标离开画布：清除悬停和拖拽状态
  const handleMouseLeave = useCallback(() => {
    if (dragStateRef.current.isDraggingNode && dragStateRef.current.draggedNode) {
      if (dragStateRef.current.hasMoved) {
        dragStateRef.current.draggedNode.pinned = true;
        dragStateRef.current.draggedNode.vx = 0;
        dragStateRef.current.draggedNode.vy = 0;
      }
    }
    dragStateRef.current.isDragging = false;
    dragStateRef.current.isDraggingNode = false;
    dragStateRef.current.draggedNode = null;
    hoveredNodeRef.current = null;
    setHoveredNodeId(null);
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = "grab";
  }, []);

  // 鼠标滚轮：缩放视图
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const transform = viewTransformRef.current;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.1, Math.min(5, transform.scale * zoomFactor));
    const scaleChange = newScale / transform.scale;

    // 以鼠标位置为中心缩放（保持鼠标下的图谱点不动）
    transform.offsetX = mouseX - (mouseX - transform.offsetX) * scaleChange;
    transform.offsetY = mouseY - (mouseY - transform.offsetY) * scaleChange;
    transform.scale = newScale;
  }, []);

  // 点击节点：导航到对应卡片（仅在未发生拖拽时触发）
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // 如果发生了拖拽，不触发点击
      if (dragStateRef.current.hasMoved) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const graphPos = screenToGraph(mouseX, mouseY);
      const node = findNodeAt(graphPos.x, graphPos.y);

      if (node) {
        // 在目录树中查找对应的文件节点
        const fileNode = findFileNodeByPath(projectTree, node.filePath);
        if (fileNode) {
          // 导航到对应分类和文件
          navigateToFile(fileNode, node.category);
        } else {
          // 回退：仅切换分类
          setActiveCategory(node.category);
        }
      }
    },
    [projectTree, navigateToFile, setActiveCategory, screenToGraph, findNodeAt]
  );

  // 双击节点：取消固定
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const graphPos = screenToGraph(mouseX, mouseY);
      const node = findNodeAt(graphPos.x, graphPos.y);

      if (node && node.pinned) {
        node.pinned = false;
        simulationActiveRef.current = true;
      }
    },
    [screenToGraph, findNodeAt]
  );

  // 重置视图
  const handleResetView = useCallback(() => {
    viewTransformRef.current = { offsetX: 0, offsetY: 0, scale: 1 };
    // 取消所有固定节点
    for (const node of nodesRef.current) {
      node.pinned = false;
    }
    simulationActiveRef.current = true;
  }, []);

  // ===== 图例数据 =====

  const legendItems = [
    { label: t("sidebar.characters"), color: "var(--fandex-primary)", category: "characters" as GraphCategory },
    { label: t("sidebar.worldview"), color: "var(--fandex-secondary)", category: "worldview" as GraphCategory },
    { label: t("sidebar.glossary"), color: "var(--fandex-tertiary)", category: "glossary" as GraphCategory },
  ];

  // ===== 空状态与加载中状态 =====

  const isEmpty = !loading && nodes.length === 0 && currentProject;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {/* 加载状态覆盖层 */}
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            backgroundColor: "var(--fandex-bg)",
            opacity: 0.85,
          }}
        >
          <span style={{ color: "var(--fandex-text)", fontSize: 14 }}>
            {t("common.loading")}
          </span>
        </div>
      )}

      {/* 空状态提示 */}
      {isEmpty && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
          }}
        >
          <span
            style={{
              color: "var(--fandex-text)",
              opacity: 0.5,
              fontSize: 14,
            }}
          >
            {t("knowledge.empty")}
          </span>
        </div>
      )}

      {/* 主画布 */}
      <canvas
        ref={canvasRef}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          cursor: "grab",
          display: "block",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      />

      {/* HTML 覆盖层：左下角图例 */}
      {nodes.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            zIndex: 20,
            backgroundColor: "var(--fandex-bg)",
            border: "1px solid var(--fandex-border)",
            borderRadius: 8,
            padding: "10px 14px",
            opacity: 0.92,
            pointerEvents: "none",
            userSelect: "none",
            minWidth: 130,
          }}
        >
          {/* 图例标题 */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--fandex-text)",
              marginBottom: 8,
              letterSpacing: "0.03em",
              fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
            }}
          >
            {t("knowledge.title")}
          </div>

          {/* 分类条目 */}
          {legendItems.map((item) => (
            <div
              key={item.category}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
                fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: item.color,
                  flexShrink: 0,
                  boxShadow: `0 0 6px ${item.color}`,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: "var(--fandex-text)",
                  opacity: 0.85,
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
            </div>
          ))}

          {/* 统计信息 */}
          <div
            style={{
              marginTop: 8,
              paddingTop: 6,
              borderTop: "1px solid var(--fandex-border)",
              fontSize: 10,
              color: "var(--fandex-text)",
              opacity: 0.5,
              fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
            }}
          >
            {graphStats.nodeCount} nodes &middot; {graphStats.edgeCount} edges
          </div>
        </div>
      )}

      {/* HTML 覆盖层：右上角重置按钮 */}
      {nodes.length > 0 && (
        <button
          onClick={handleResetView}
          title="Reset view / Unpin all nodes"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 20,
            width: 32,
            height: 32,
            borderRadius: 6,
            border: "1px solid var(--fandex-border)",
            backgroundColor: "var(--fandex-bg)",
            color: "var(--fandex-text)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.8,
            transition: "opacity 0.15s, background-color 0.15s",
            padding: 0,
            fontSize: 16,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = "1";
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--fandex-border)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = "0.8";
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--fandex-bg)";
          }}
        >
          {/* 简单重置图标 (SVG) */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 8a6 6 0 0 1 10.3-4.2L14 2v4h-4l1.7-1.7A4.5 4.5 0 1 0 12.5 8" />
          </svg>
        </button>
      )}

      {/* 悬停节点提示（HTML 覆盖层，跟随鼠标位置） */}
      {hoveredNodeId && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            backgroundColor: "var(--fandex-bg)",
            border: "1px solid var(--fandex-border)",
            borderRadius: 6,
            padding: "4px 12px",
            opacity: 0.9,
            pointerEvents: "none",
            userSelect: "none",
            fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
            fontSize: 12,
            color: "var(--fandex-text)",
            whiteSpace: "nowrap",
          }}
        >
          {(() => {
            const node = nodesRef.current.find((n) => n.id === hoveredNodeId);
            if (!node) return "";
            const catLabel =
              node.category === "characters"
                ? t("sidebar.characters")
                : node.category === "worldview"
                ? t("sidebar.worldview")
                : t("sidebar.glossary");
            return `${node.label}  ·  ${catLabel}${node.pinned ? "  ·  pinned" : ""}`;
          })()}
        </div>
      )}
    </div>
  );
}

/**
 * 在项目目录树中按相对路径查找文件节点
 */
function findFileNodeByPath(tree: FileNode[], relativePath: string): FileNode | null {
  const normalized = relativePath.replace(/\\/g, "/");
  for (const node of tree) {
    const nodePath = node.relative_path.replace(/\\/g, "/");
    if (nodePath === normalized && !node.is_dir) return node;
    if (node.is_dir && node.children.length > 0) {
      const found = findFileNodeByPath(node.children, relativePath);
      if (found) return found;
    }
  }
  return null;
}
