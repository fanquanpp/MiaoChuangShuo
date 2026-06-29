// 知识图谱组件（Obsidian 风格力导向图）
//
// 功能概述：
// 使用 HTML Canvas 渲染小说项目的知识图谱，展示角色、世界观、名词之间的关联关系。
// 采用弹簧-库仑力模型实现力导向布局，支持平移、缩放、悬停高亮和点击导航。
//
// 模块职责：
// 1. 从项目目录树加载角色/世界观/名词卡片数据
// 2. 通过文本交叉引用提取卡片间的关联边
// 3. 运行力导向物理模拟并渲染到 Canvas
// 4. 支持平移（拖拽背景）、缩放（滚轮）、悬停高亮、点击导航到卡片

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
}

// 图谱边接口
interface GraphEdge {
  source: string;  // 源节点 ID
  target: string;  // 目标节点 ID
}

// ===== 物理模拟常量 =====

const REPULSION_STRENGTH = 3000;    // 库仑斥力强度
const SPRING_STRENGTH = 0.005;      // 弹簧引力系数
const SPRING_REST_LENGTH = 150;     // 弹簧自然长度（像素）
const CENTER_GRAVITY = 0.01;        // 中心引力系数
const VELOCITY_DAMPING = 0.85;      // 速度衰减因子（每帧乘以该值）
const MIN_VELOCITY = 0.01;          // 最小速度阈值（低于此值视为静止）
const MAX_VELOCITY = 10;            // 最大速度限制（防止爆炸）
const NODE_RADIUS = 20;             // 节点半径（像素）
const LABEL_MAX_LENGTH = 8;         // 标签最大字符数（超出截断加省略号）
const HOVER_RADIUS_FACTOR = 1.5;    // 悬停检测半径放大系数

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

  // 拖拽状态
  const dragStateRef = useRef({
    isDragging: false,
    lastX: 0,
    lastY: 0,
  });

  // 节点数据引用（物理模拟直接修改，避免频繁 setState）
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);

  // 模拟是否已趋于稳定（减少不必要的重绘）
  const simulationActiveRef = useRef(true);

  // ===== 数据加载 =====

  useEffect(() => {
    if (!currentProject || projectTree.length === 0) {
      setNodes([]);
      setEdges([]);
      nodesRef.current = [];
      edgesRef.current = [];
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
        simulationActiveRef.current = true;

        // 重置视图变换，居中显示
        viewTransformRef.current = { offsetX: 0, offsetY: 0, scale: 1 };
      } catch (err) {
        console.error("[KnowledgeGraph] \u52a0\u8f7d\u56fe\u8c31\u6570\u636e\u5931\u8d25:", err);
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
     * 4. 衰减速度并更新位置
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
          ni.vx += fx;
          ni.vy += fy;
          nj.vx -= fx;
          nj.vy -= fy;
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
        ns.vx += fx;
        ns.vy += fy;
        nt.vx -= fx;
        nt.vy -= fy;
      }

      // --- 中心引力 + 速度衰减 + 位置更新 ---
      for (const node of nodeList) {
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
     * 渲染一帧：清空画布、绘制边、绘制节点、绘制标签、绘制图例
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

      // --- 绘制边 ---
      ctx.lineWidth = 1 / transform.scale; // 保持边线宽不随缩放变化
      for (const edge of edgeList) {
        const ns = nodeMap.get(edge.source);
        const nt = nodeMap.get(edge.target);
        if (!ns || !nt) continue;

        // 判断是否为悬停节点相关的边（高亮显示）
        const isHighlighted =
          hovered && (hovered.id === edge.source || hovered.id === edge.target);

        ctx.beginPath();
        ctx.moveTo(ns.x, ns.y);
        ctx.lineTo(nt.x, nt.y);
        if (isHighlighted) {
          ctx.strokeStyle = textColor;
          ctx.lineWidth = 2 / transform.scale;
          ctx.globalAlpha = 0.9;
        } else {
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1 / transform.scale;
          ctx.globalAlpha = 0.4;
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // --- 绘制节点 ---
      for (const node of nodeList) {
        const color = categoryColors[node.category];
        const isHovered = hovered && hovered.id === node.id;
        const isConnected =
          hovered &&
          edgeList.some(
            (e) =>
              (e.source === hovered.id && e.target === node.id) ||
              (e.target === hovered.id && e.source === node.id)
          );
        const radius = isHovered
          ? NODE_RADIUS * 1.3
          : isConnected
          ? NODE_RADIUS * 1.1
          : NODE_RADIUS;

        // 悬停或连接节点以外的节点在有悬停时半透明显示
        if (hovered && !isHovered && !isConnected) {
          ctx.globalAlpha = 0.25;
        }

        // 绘制节点圆形（外发光效果）
        if (isHovered) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 15;
        }
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // 节点描边
        ctx.strokeStyle = isHovered ? textColor : "rgba(255,255,255,0.2)";
        ctx.lineWidth = isHovered ? 2.5 / transform.scale : 1 / transform.scale;
        ctx.stroke();

        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      // --- 绘制节点标签 ---
      const fontSize = Math.max(10, 12 / transform.scale);
      ctx.font = `${fontSize}px "Inter", "Noto Sans SC", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      for (const node of nodeList) {
        const isHovered = hovered && hovered.id === node.id;
        const isConnected =
          hovered &&
          edgeList.some(
            (e) =>
              (e.source === hovered.id && e.target === node.id) ||
              (e.target === hovered.id && e.source === node.id)
          );

        // 有悬停时，仅显示悬停节点及其相邻节点的标签
        if (hovered && !isHovered && !isConnected) {
          ctx.globalAlpha = 0.15;
        }

        const displayLabel = truncateLabel(node.label, LABEL_MAX_LENGTH);
        const labelY = node.y + NODE_RADIUS + 4;

        // 标签背景（提升可读性）
        const metrics = ctx.measureText(displayLabel);
        const padding = 3;
        ctx.fillStyle = bgColor;
        ctx.globalAlpha = Math.max(ctx.globalAlpha * 0.7, 0);
        ctx.fillRect(
          node.x - metrics.width / 2 - padding,
          labelY - 1,
          metrics.width + padding * 2,
          fontSize + padding * 2
        );

        // 标签文本
        ctx.globalAlpha = hovered && !isHovered && !isConnected ? 0.15 : 0.9;
        ctx.fillStyle = textColor;
        ctx.fillText(displayLabel, node.x, labelY + padding);
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      // --- 绘制图例（左下角，不受视图变换影响） ---
      drawLegend(ctx, categoryColors, width, height, textColor, bgColor, borderColor);
    }

    /**
     * 绘制左下角的分类颜色图例
     */
    function drawLegend(
      ctx: CanvasRenderingContext2D,
      colors: Record<GraphCategory, string>,
      canvasWidth: number,
      canvasHeight: number,
      textColor: string,
      bgColor: string,
      borderColor: string
    ) {
      const legendItems = [
        { label: t("sidebar.characters"), color: colors.characters },
        { label: t("sidebar.worldview"), color: colors.worldview },
        { label: t("sidebar.glossary"), color: colors.glossary },
      ];

      const itemHeight = 20;
      const dotRadius = 6;
      const padding = 12;
      const legendWidth = 120;
      const legendHeight = legendItems.length * itemHeight + padding * 2;
      const x = padding;
      const y = canvasHeight - legendHeight - padding;

      // 图例背景
      ctx.fillStyle = bgColor;
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, legendWidth, legendHeight, 6);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 图例标题
      ctx.font = `bold 11px "Inter", "Noto Sans SC", system-ui, sans-serif`;
      ctx.fillStyle = textColor;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(t("knowledge.title"), x + padding, y + padding + 2);

      // 各分类条目
      ctx.font = `11px "Inter", "Noto Sans SC", system-ui, sans-serif`;
      legendItems.forEach((item, i) => {
        const itemY = y + padding + 18 + i * itemHeight;

        // 颜色圆点
        ctx.beginPath();
        ctx.arc(x + padding + dotRadius, itemY + itemHeight / 2, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();

        // 分类名称
        ctx.fillStyle = textColor;
        ctx.fillText(item.label, x + padding + dotRadius * 2 + 8, itemY + itemHeight / 2);
      });
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
      const dpr = window.devicePixelRatio || 1;
      const rect = parent.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      // 调整 canvas 物理尺寸后以实际像素宽高存储，render 里使用 canvas.width/height
      // 但为了坐标一致性，这里将宽高设为 CSS 像素值
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

  // ===== 鼠标交互：平移、缩放、悬停、点击 =====

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

  // 鼠标按下：开始拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    dragStateRef.current = {
      isDragging: true,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  }, []);

  // 鼠标移动：拖拽平移 + 悬停检测
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (dragStateRef.current.isDragging) {
        // 平移视图
        const dx = e.clientX - dragStateRef.current.lastX;
        const dy = e.clientY - dragStateRef.current.lastY;
        viewTransformRef.current.offsetX += dx;
        viewTransformRef.current.offsetY += dy;
        dragStateRef.current.lastX = e.clientX;
        dragStateRef.current.lastY = e.clientY;
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

  // 鼠标释放：结束拖拽
  const handleMouseUp = useCallback(() => {
    dragStateRef.current.isDragging = false;
  }, []);

  // 鼠标离开画布：清除悬停和拖拽状态
  const handleMouseLeave = useCallback(() => {
    dragStateRef.current.isDragging = false;
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

  // 点击节点：导航到对应卡片
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // 如果发生了拖拽，不触发点击
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
      />
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
