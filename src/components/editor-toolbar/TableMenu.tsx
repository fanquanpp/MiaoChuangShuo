// 表格操作菜单组件
//
// 功能概述：
// 提供表格插入与编辑操作的下拉菜单，包括插入表格、添加/删除行列、合并/拆分单元格、删除表格。
// 通过 Dropdown 容器实现点击外部 / Esc 关闭，调用 TipTap 表格扩展命令。
//
// 模块职责：
// 仅负责表格命令的可用性检测与调用，不持有编辑器实例的所有权（通过 props 接收）。
// 当编辑器未注册 @tiptap/extension-table 时，命令调用会被安全忽略（try-catch 兜底）。

import type { Editor } from "@tiptap/core";
import {
  Table2,
  Rows3,
  Columns3,
  Minus,
  Combine,
  Split,
  Trash2,
} from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { Dropdown } from "./Dropdown";

// 表格菜单属性
interface TableMenuProps {
  /** TipTap 编辑器实例（可能为 null） */
  editor: Editor | null;
}

// 编辑器链式命令类型（由 Editor.chain() 返回类型推断）
type EditorChain = ReturnType<Editor["chain"]>;

// 表格扩展提供的额外链式命令（仅当编辑器注册了 @tiptap/extension-table 时存在）
interface TableExtraCommands {
  insertTable: (options?: {
    rows?: number;
    cols?: number;
    withHeaderRow?: boolean;
  }) => EditorChain & TableExtraCommands;
  addRowBefore: () => EditorChain & TableExtraCommands;
  addRowAfter: () => EditorChain & TableExtraCommands;
  addColumnBefore: () => EditorChain & TableExtraCommands;
  addColumnAfter: () => EditorChain & TableExtraCommands;
  deleteRow: () => EditorChain & TableExtraCommands;
  deleteColumn: () => EditorChain & TableExtraCommands;
  mergeCells: () => EditorChain & TableExtraCommands;
  splitCell: () => EditorChain & TableExtraCommands;
  deleteTable: () => EditorChain & TableExtraCommands;
}

// 含表格命令的链式命令类型
type TableChain = EditorChain & TableExtraCommands;

// 表格操作项定义
interface TableMenuItem {
  /** 操作标识，用于 React key */
  key: string;
  /** 显示标签 */
  label: string;
  /** 图标节点 */
  icon: React.ReactNode;
  /** 是否禁用（非表格上下文时表格编辑操作禁用） */
  disabled: boolean;
  /** 执行的命令（接收断言后的链式命令） */
  run: (chain: TableChain) => void;
}

/**
 * 表格操作下拉菜单
 *
 * 输入参数:
 *   - editor: TipTap 编辑器实例，null 时组件不渲染
 * 返回值: JSX 表格操作菜单，editor 为 null 时返回 null
 * 核心流程:
 *   1. 检测当前是否处于表格上下文（isActive("table")）
 *   2. 插入表格始终可用；表格编辑操作仅表格上下文可用
 *   3. 点击菜单项时通过 try-catch 安全调用表格命令，扩展未注册时忽略
 */
export function TableMenu({ editor }: TableMenuProps) {
  const { t } = useI18n();
  // 编辑器未就绪时不渲染
  if (!editor) return null;

  // 是否处于表格上下文（决定表格编辑操作是否可用）
  const inTable = editor.isActive("table");

  // 安全执行表格命令：扩展未注册时命令方法不存在，try-catch 兜底
  const runCommand = (apply: (chain: TableChain) => void): void => {
    try {
      const chain = editor.chain().focus() as TableChain;
      apply(chain);
      chain.run();
    } catch {
      // 表格扩展未注册时命令不存在，安全忽略
    }
  };

  // 菜单项列表：插入表格始终可用，其余项依据 inTable 启用
  const items: TableMenuItem[] = [
    {
      key: "insert",
      label: t("editor.insertTable"),
      icon: <Table2 className="w-4 h-4" />,
      disabled: false,
      run: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    },
    {
      key: "addRowBefore",
      label: t("editor.addRowBefore"),
      icon: <Rows3 className="w-4 h-4" />,
      disabled: !inTable,
      run: (chain) => chain.addRowBefore(),
    },
    {
      key: "addRowAfter",
      label: t("editor.addRowAfter"),
      icon: <Rows3 className="w-4 h-4" />,
      disabled: !inTable,
      run: (chain) => chain.addRowAfter(),
    },
    {
      key: "addColumnBefore",
      label: t("editor.addColumnBefore"),
      icon: <Columns3 className="w-4 h-4" />,
      disabled: !inTable,
      run: (chain) => chain.addColumnBefore(),
    },
    {
      key: "addColumnAfter",
      label: t("editor.addColumnAfter"),
      icon: <Columns3 className="w-4 h-4" />,
      disabled: !inTable,
      run: (chain) => chain.addColumnAfter(),
    },
    {
      key: "deleteRow",
      label: t("editor.deleteRow"),
      icon: <Minus className="w-4 h-4" />,
      disabled: !inTable,
      run: (chain) => chain.deleteRow(),
    },
    {
      key: "deleteColumn",
      label: t("editor.deleteColumn"),
      icon: <Minus className="w-4 h-4" />,
      disabled: !inTable,
      run: (chain) => chain.deleteColumn(),
    },
    {
      key: "mergeCells",
      label: t("editor.mergeCells"),
      icon: <Combine className="w-4 h-4" />,
      disabled: !inTable,
      run: (chain) => chain.mergeCells(),
    },
    {
      key: "splitCell",
      label: t("editor.splitCell"),
      icon: <Split className="w-4 h-4" />,
      disabled: !inTable,
      run: (chain) => chain.splitCell(),
    },
    {
      key: "deleteTable",
      label: t("editor.deleteTable"),
      icon: <Trash2 className="w-4 h-4" />,
      disabled: !inTable,
      run: (chain) => chain.deleteTable(),
    },
  ];

  return (
    <Dropdown
      trigger={
        <span className="flex items-center gap-1">
          <Table2 className="w-4 h-4" />
        </span>
      }
      active={inTable}
      title={t("editor.tableMenu")}
      panelWidth="w-48"
    >
      <div className="py-1">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            onClick={() => runCommand(item.run)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed ${
              item.disabled
                ? "text-nf-text-tertiary"
                : "text-nf-text hover:bg-nf-bg-hover"
            }`}
          >
            <span className="text-nf-text-secondary">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </Dropdown>
  );
}

export default TableMenu;
