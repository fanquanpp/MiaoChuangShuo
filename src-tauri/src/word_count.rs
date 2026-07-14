// 共享字数统计模块
//
// 功能概述：
// 提供统一的中英文字数统计函数，供 commands 与 snapshot_commands 复用，
// 消除原先在多个模块中重复实现的 count_chinese_and_words / count_words_simple。
//
// 模块职责：
// 1. 统一中文汉字 + 英文单词的计数规则
// 2. 供其他 Rust 模块通过 use crate::word_count::count_words 调用
//
// 计数规则：
// - 中文字符（基本汉字区 U+4E00..U+9FFF、扩展A区 U+3400..U+4DBF、兼容汉字区 U+F900..U+FAFF）按 1 字计算
// - 英文连续字母序列作为一个单词按 1 字计算
// - 数字、标点、空白等不计入

/// 统计中文字符与英文单词数
/// 输入: text 文本内容
/// 输出: u64 字数
/// 流程: 遍历字符，中文字符计数，英文连续字母作为一个单词
pub fn count_words(text: &str) -> u64 {
    let mut count: u64 = 0;
    let mut in_word = false;
    for ch in text.chars() {
        // 中文字符范围(基本汉字 + 扩展A + 兼容汉字)
        if ('\u{4E00}'..='\u{9FFF}').contains(&ch)
            || ('\u{3400}'..='\u{4DBF}').contains(&ch)
            || ('\u{F900}'..='\u{FAFF}').contains(&ch)
        {
            count += 1;
            in_word = false;
        } else if ch.is_alphabetic() {
            if !in_word {
                count += 1;
                in_word = true;
            }
        } else {
            in_word = false;
        }
    }
    count
}
