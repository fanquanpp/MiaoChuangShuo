# Schema 版本迁移机制

本文档描述 喵创说 (MiaoChuangShuo) 项目中数据结构的 schema 版本管理与迁移流程,涵盖 manifest、剧情时间线、人物关系图三套独立 schema 体系,以及章节/大纲文件的 front matter 注入机制。

## 一、设计目标

- **向后兼容**:旧项目首次打开时自动迁移到新格式,无需用户手动干预
- **向前容错**:加载高于当前支持的 schema 版本时返回明确错误,避免静默数据损坏
- **原子写入**:所有持久化文件采用"临时文件 + rename"策略,防止写入中途崩溃导致 JSON 损坏
- **增量迁移**:迁移在 load 时于内存中完成,save 时写入最新版本,避免 load 产生副作用 IO

## 二、Schema 版本体系

项目存在三套独立的 schema 版本体系,各自维护 `LATEST_SCHEMA_VERSION` / `SCHEMA_VERSION` 常量:

| 数据文件 | 模块 | 常量 | 当前版本 | 字段名 |
|---------|------|------|---------|--------|
| `.novelforge/manifest.json` | `manifest.rs` | `SCHEMA_VERSION` | `1` | `schemaVersion` (u32) |
| `剧情图谱/timeline.json` | `timeline_commands.rs` | `LATEST_SCHEMA_VERSION` | `1` | `schemaVersion` (i32) |
| `人物关系图/character_graph.json` | `character_graph_commands.rs` | `LATEST_SCHEMA_VERSION` | `1` | `schemaVersion` (i32) |

三套体系互不依赖,可独立演进。

## 三、迁移流程

### 3.1 Load 阶段(读取时迁移)

所有 load 函数遵循统一流程:

```
1. 清理上次写入崩溃残留的 .tmp 文件
2. 文件不存在时返回默认空对象(schema_version = LATEST)
3. 读取并反序列化 JSON
4. 检测 schema_version:
   - 低于 LATEST:调用 migrate_schema() 逐步升级
   - 等于 LATEST:直接返回
   - 高于 LATEST:返回错误(不支持的版本)
5. 返回迁移后的对象
```

相关函数:

- `manifest.rs::load_manifest` → 调用 `migrate_manifest(manifest)`
- `timeline_commands.rs::read_timeline` → 调用 `migrate_schema(graph, LATEST_SCHEMA_VERSION)`
- `character_graph_commands.rs::read_character_graph` → 调用 `migrate_schema(graph, LATEST_SCHEMA_VERSION)`

### 3.2 Save 阶段(写入时标记版本)

所有 save 函数在序列化前强制将 `schema_version` 设置为 `LATEST_SCHEMA_VERSION`(Task 1.9.2):

```
1. 校验数据完整性(节点 ID 唯一性 / 边引用 / 环检测)
2. 确保目标目录存在
3. 更新 updatedAt 时间戳
4. 强制设置 schema_version = LATEST_SCHEMA_VERSION
5. 序列化为 pretty JSON
6. 写入 .json.tmp 临时文件
7. 原子 rename 到 .json
8. 生成 txt 摘要(失败不阻塞,仅 timeline / character_graph)
```

此设计确保:文件落盘时即标记为当前版本,后续 load 无需再触发迁移路径。

### 3.3 Manifest 迁移骨架

`manifest.rs::migrate_manifest` 采用预留骨架设计:

```rust
pub fn migrate_manifest(mut manifest: Manifest) -> Manifest {
    // 当前为 v1 初始版本,无更低版本迁移逻辑
    // 预留迁移分支示例(未来启用):
    // if manifest.schema_version < 2 {
    //     migrate_v1_to_v2(&mut manifest);
    // }
    if manifest.schema_version != SCHEMA_VERSION {
        manifest.schema_version = SCHEMA_VERSION;
    }
    manifest
}
```

## 四、新增 Schema 版本步骤

当需要引入 schema v2 时,按以下步骤操作:

### 4.1 修改常量

将对应模块的 `SCHEMA_VERSION` 或 `LATEST_SCHEMA_VERSION` 从 `1` 改为 `2`。

### 4.2 实现迁移函数

在对应模块新增 `migrate_v1_to_v2` 函数,完成字段重命名、默认值填充、数据重组等逻辑。

### 4.3 注册迁移分支

在 `migrate_schema` / `migrate_manifest` 函数的 match / if 分支中追加新版本迁移路径:

```rust
// timeline_commands.rs / character_graph_commands.rs 示例
match current.schema_version {
    1 => {
        let v2 = migrate_v1_to_v2(current);
        migrate_schema(v2, target_version)  // 递归调用以支持多版本跳跃
    }
    v => Err(format!("无法从版本 {} 迁移到 {}", v, target_version)),
}
```

### 4.4 更新本文档

在"版本变更记录"章节追加 v2 的变更说明,包含字段差异、迁移逻辑、向后兼容策略。

### 4.5 验证迁移

准备 v1 格式的测试数据文件,验证:

- load 后 schema_version 升级为 2
- 字段正确迁移,无数据丢失
- save 后文件标记为 v2
- 重新 load 不再触发迁移

## 五、章节与大纲文件 Front Matter(Task 1.3)

### 5.1 Front Matter 格式

章节文件(`正文/*.pmd`、`正文/*.txt`)与大纲文件(`大纲/*.pmd`)在创建时自动注入 YAML 风格 front matter:

```
---
id: 550e8400-e29b-41d4-a716-446655440000
title: 第一章 起点
---

<ProseMirror JSON 或纯文本内容>
```

字段说明:

- `id`:UUID v4,与 manifest 中 `ManifestEntity.id` 一致,用于跨模块关联
- `title`:文件名(不含扩展名),用于显示与搜索

### 5.2 注入与提取

相关函数位于 `text_extractor.rs`:

- `inject_front_matter(content: &str, meta: &[(String, String)]) -> String`
  注入 front matter 到内容头部,已有 front matter 时跳过

- `extract_front_matter(content: &str) -> Option<(String, String)>`
  提取 front matter 字段,返回 (front_matter 文本, 剩余内容)

### 5.3 章节文件创建流程(`file_io_commands.rs::create_file`)

```
1. 校验路径合法性
2. 生成 UUID v4 作为 entity_id
3. 检测是否为章节文件(正文目录下 .pmd/.txt):
   - 是:注入 front matter(id / title)
   - 否:原样写入
4. 原子写入文件
5. 同步索引(tantivy)
6. 注册到 manifest(try_register_chapter,携带同一 entity_id)
```

### 5.4 章节保存字数同步(Task 1.3.4)

`file_io_commands.rs::write_file` 在写入章节文件后:

1. 调用 `text_extractor::extract_plain_text` 剥离 front matter / JSON 结构
2. 调用 `word_count::count_words` 统计纯文本字数
3. 调用 `manifest::try_update_chapter_word_count` 增量更新 manifest 中的 `wordCount` 字段

### 5.5 大纲文件迁移(Task 1.3.3)

`manifest.rs::migrate_outline_to_pmd` 实现大纲文件从 `.txt` 到 `.pmd` 的迁移:

1. 读取 `ProjectMeta.outlineDir` 获取大纲目录名(默认"大纲")
2. 递归扫描大纲目录下所有 `.txt` 文件
3. 对每个 `.txt` 文件:
   - 读取内容,生成 UUID v4
   - 调用 `convert_text_to_pmd_json` 转换为 ProseMirror JSON
   - 注入 front matter(id / title)
   - 原子写入 `.pmd` 文件
   - 旧 `.txt` 重命名为 `.bak` 作为备份(Task 1.3.5)
   - 注册 outline 实体到 manifest
4. 已存在 `.pmd` 文件的 `.txt` 跳过(支持增量迁移,中断后重跑安全)

前端通过 `migrate_project_data` Tauri 命令触发迁移,适用于旧项目首次打开场景。

## 六、JSON Schema 自动生成(Task 1.7)

### 6.1 设计目的

利用 `schemars` crate 为核心数据结构自动生成 JSON Schema 文件,实现:

- 前端 TS 类型与后端 Rust 结构体的单一数据源
- CI 中校验类型一致性,防止字段漂移
- 文档化数据结构的字段约束与默认值

### 6.2 生成命令

`schema_commands.rs::generate_schemas(output_dir: String) -> Result<Vec<String>, AppError>`

- 输入:输出目录绝对路径(为空时使用项目根的 `schemas/` 目录)
- 输出:生成的 Schema 文件路径列表
- 覆盖结构体:`ProjectMeta` / `Manifest` / `ManifestEntity` / `ManifestEntities` / `ReverseIndex` / `AiConfig` / `EditorPreferences` / `ProjectConfig` / `CustomRelationType` / `TimelineGraph` / `TimelineNodeData` / `PersistedNode` / `PersistedEdge` / `CharacterGraph` / `CharacterNodeData` / `CharacterPersistedNode` / `CharacterPersistedEdge` / `SnapshotMeta` / `CustomTemplate` / `WritingStatsSnapshot`

### 6.3 前端 TS 类型生成(Task 1.7.4)

使用 `json-schema-to-typescript` 从 Schema 文件生成 TS 类型定义:

```bash
# 安装工具
npm install --save-dev json-schema-to-typescript

# 生成 TS 类型(示例)
npx json2ts schemas/Manifest.schema.json src/types/schema/Manifest.ts
```

建议在 `package.json` 中添加 script 批量生成:

```json
{
  "scripts": {
    "gen:schemas": "node scripts/gen-schemas.mjs"
  }
}
```

### 6.4 CI 一致性检查(Task 1.7.5)

在 CI 流水线中添加 schema 一致性检查步骤:

```yaml
- name: 校验 Schema 一致性
  run: |
    # 1. 调用后端命令生成最新 Schema
    # 2. 与 schemas/ 目录下的提交版本 diff
    # 3. 若有差异,提示开发者更新 Schema 文件并重新提交
    git diff --exit-code schemas/
```

## 七、版本变更记录

### v1(初始版本)

**Manifest**(`manifest.rs`):

- 初始 schema,包含 `projectId` / `projectName` / `schemaVersion` / `entities` / `reverseIndex` / `createdAt` / `updatedAt` 字段
- `ManifestEntities` 包含 `chapters` / `outlines` / `codex` / `graphNodes` / `graphEdges` / `timelineNodes` / `timelineEdges` 七类实体集合
- `ManifestEntity` 包含 `id` / `type` / `sourceFile` / `title` / `wordCount` / `createdAt` / `updatedAt` / `extra` 字段

**TimelineGraph**(`timeline_commands.rs`):

- 初始 schema,包含 `schemaVersion` / `projectId` / `projectName` / `updatedAt` / `nodes` / `edges` 字段
- 节点支持 `Main` / `Branch` / `Event` / `Ending` 四种类型
- 节点状态支持 `Planned` / `Writing` / `Done` 三种状态

**CharacterGraph**(`character_graph_commands.rs`):

- 初始 schema,包含 `schemaVersion` / `projectId` / `projectName` / `updatedAt` / `nodes` / `edges` 字段
- 节点包含 `name` / `identity` / `tags` / `brief` / `sourceFile` 字段
- 边包含 `relationType` / `description` 字段,允许环存在

## 八、相关文件索引

| 文件 | 职责 |
|------|------|
| `src-tauri/src/manifest.rs` | manifest schema 定义、load/save、迁移、大纲文件迁移 |
| `src-tauri/src/timeline_commands.rs` | 剧情时间线 schema 定义、load/save、迁移 |
| `src-tauri/src/character_graph_commands.rs` | 人物关系图 schema 定义、load/save、迁移 |
| `src-tauri/src/schema_commands.rs` | JSON Schema 自动生成命令 |
| `src-tauri/src/text_extractor.rs` | front matter 注入与提取 |
| `src-tauri/src/commands/file_io_commands.rs` | 章节文件创建/保存,UUID 注入,字数同步 |
| `src-tauri/src/lib.rs` | 命令注册入口 |
