// 内置示例项目数据
//
// 功能概述:
// 为「喵创说」在线体验版提供内置示例项目 "示例小说", 包含 3 章示例内容。
// 用户首次打开 Web 版时自动注入, 帮助快速体验核心创作功能。
// 示例内容为原创短篇, 不涉及任何版权风险。
//
// 模块职责:
// 1. getSampleProject: 返回示例项目元数据
// 2. getSampleChapters: 返回 3 章示例章节 (ProseMirror JSON)

import type { ProseMirrorNode, WebProject } from "./types";

// 桌面版下载链接 (GitHub Releases)
export const DESKTOP_DOWNLOAD_URL = "https://github.com/fanquanpp/MiaoChuangShuo/releases";
// 桌面版仓库地址
export const REPO_URL = "https://github.com/fanquanpp/MiaoChuangShuo";

/**
 * 返回示例项目元数据
 * 输入: 无
 * 输出: WebProject 对象 (不含时间戳, 由调用方填充)
 * 流程: 返回固定的示例项目定义
 */
export function getSampleProject(): Omit<WebProject, "createdAt" | "updatedAt"> {
  return {
    id: "sample-novel-0001",
    name: "示例小说 - 长安秋",
    type: "novel",
    wordCount: 0,
  };
}

/**
 * 返回示例章节列表 (3 章)
 * 输入: 无
 * 输出: 章节数组, 每章包含 name 与 ProseMirror content
 * 流程: 返回固定的 3 章示例内容
 */
export function getSampleChapters(): Array<{ name: string; content: ProseMirrorNode }> {
  return [
    {
      name: "第一章 长安秋风起",
      content: buildChapterOne(),
    },
    {
      name: "第二章 故人重逢",
      content: buildChapterTwo(),
    },
    {
      name: "第三章 月下论剑",
      content: buildChapterThree(),
    },
  ];
}

// ========== 章节内容构建辅助函数 ==========

/**
 * 创建段落节点
 * 输入: text 段落文本
 * 输出: ProseMirror paragraph 节点
 */
function p(text: string): ProseMirrorNode {
  return {
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  };
}

/**
 * 创建带粗体标记的段落
 * 输入: text 段落文本, boldText 需加粗的部分
 * 输出: ProseMirror paragraph 节点 (含 bold mark)
 */
function pWithBold(text: string, boldText: string): ProseMirrorNode {
  const idx = text.indexOf(boldText);
  if (idx === -1) return p(text);
  return {
    type: "paragraph",
    content: [
      ...(idx > 0 ? [{ type: "text", text: text.slice(0, idx) }] : []),
      { type: "text", text: boldText, marks: [{ type: "bold" }] },
      ...(idx + boldText.length < text.length
        ? [{ type: "text", text: text.slice(idx + boldText.length) }]
        : []),
    ],
  };
}

/**
 * 创建引用块节点
 * 输入: text 引用文本
 * 输出: ProseMirror blockquote 节点
 */
function quote(text: string): ProseMirrorNode {
  return {
    type: "blockquote",
    content: [p(text)],
  };
}

/**
 * 构建第一章内容
 * 输入: 无
 * 输出: ProseMirror 文档节点
 */
function buildChapterOne(): ProseMirrorNode {
  return {
    type: "doc",
    content: [
      pWithBold(
        "天宝三年, 长安城的秋风比往年更早一些。城门外的槐树叶尚未转黄, 已被一阵阵西风卷落, 铺满了朱雀大街的青石板。",
        "长安城"
      ),
      p(
        "沈砚之背着一个旧布囊, 站在春明门前。他抬头望了一眼城楼上的匾额, 那三个金字在暮色里有些黯淡, 像是被人用手指反复摩挲过。"
      ),
      p(
        "守城的兵士看他衣着素朴, 又见那布囊里鼓鼓囊囊, 便多问了几句。沈砚之从怀里摸出一封书信, 兵士接过看了, 脸色微变, 连忙挥手放行。"
      ),
      quote("长安, 我回来了。"),
      p(
        "他低声说了一句, 像是对自己说, 又像是对这座城说。十年前他离京南下时, 也是一个秋天。那时他还是个未及第的少年, 怀着一腔抱负, 却落得铩羽而归。如今再回来, 物是人非, 唯有这座城依旧。"
      ),
      p(
        "街边的酒肆已经亮起灯笼, 红光摇曳, 把沈砚之的影子拉得很长。他沿着街边慢慢走, 不知不觉走到了平康坊的入口。"
      ),
    ],
  };
}

/**
 * 构建第二章内容
 * 输入: 无
 * 输出: ProseMirror 文档节点
 */
function buildChapterTwo(): ProseMirrorNode {
  return {
    type: "doc",
    content: [
      pWithBold(
        "平康坊的裴记酒肆, 是沈砚之十年前常去的地方。推门进去, 热气混着酒香扑面而来, 一切竟与记忆中分毫不差。",
        "裴记酒肆"
      ),
      p(
        "掌柜裴老正在柜台后拨算盘, 听见门响抬头, 一眼便认出了来人。他手里的算盘停在半空, 老泪几乎夺眶而出。"
      ),
      quote("砚之, 真的是你?"),
      p(
        "沈砚之拱手行礼: 裴伯, 别来无恙。裴老绕出柜台, 一把拉住他的手腕, 上下打量, 连连点头, 又连连摇头。"
      ),
      p(
        "正说话间, 门外又进来一人。那人身着青衫, 腰悬长剑, 眉宇间带着一股英气。四目相对, 两人都愣在原地。"
      ),
      pWithBold(
        "来人正是沈砚之幼时同窗、如今禁军中郎将的顾长卿。十年阔别, 当年的瘦弱少年已长成了长安城中最年轻的将军。",
        "顾长卿"
      ),
      quote("砚之兄, 我以为你这辈子都不会再回长安了。"),
      p(
        "沈砚之苦笑: 我自己也这样以为。顾长卿拍了拍他的肩, 力道很重, 像是要确认眼前人是真的。"
      ),
    ],
  };
}

/**
 * 构建第三章内容
 * 输入: 无
 * 输出: ProseMirror 文档节点
 */
function buildChapterThree(): ProseMirrorNode {
  return {
    type: "doc",
    content: [
      pWithBold(
        "当夜, 顾长卿在自家宅院设宴, 为沈砚之接风。酒过三巡, 月色正好, 两人移席后园, 在一株老桂树下对坐。",
        "老桂树下"
      ),
      p(
        "顾长卿解下腰间长剑, 随手抛给沈砚之。剑入鞘, 沉甸甸的, 剑身上刻着两个小字: 破阵。"
      ),
      quote("这剑, 你认得?"),
      p(
        "沈砚之摩挲着剑鞘上的纹路, 沉吟片刻: 这是我父亲当年的佩剑。当年他出征吐蕃, 便是带着这把破阵。后来...后来他没能回来。"
      ),
      p(
        "顾长卿点头: 令尊殉国后, 这剑被送回了长安。先皇念其忠勇, 命人妥善保管。我入禁军后, 圣上将它赐给了我, 说是物归故人之子, 理所应当。"
      ),
      p(
        "月色清冷, 桂花香气浮动。沈砚之拔剑出鞘, 剑光如水, 映着他半张脸。十年了, 他终于又握住了这把剑。"
      ),
      quote("长卿, 我这次回长安, 是有一件事要办。"),
      p(
        "顾长卿神色一凛: 什么事? 沈砚之将剑缓缓入鞘, 声音压得很低: 查清我父亲真正的死因。"
      ),
      p(
        "风过桂树, 落花满地。顾长卿沉默良久, 终于开口: 砚之兄, 这条路一旦走上去, 就回不了头了。"
      ),
    ],
  };
}
