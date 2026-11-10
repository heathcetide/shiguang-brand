import React from "react";
import { View, Text } from "react-native";

interface AIMarkdownProps {
  content: string;
}

/**
 * 专为 AI 对话设计的 Markdown 与表格优雅渲染组件
 * 支持 Markdown 表格 (| Col | Col |)、标题 (##)、列表 (-)、粗体 (**) 渲染
 */
export const AIMarkdown: React.FC<AIMarkdownProps> = ({ content }) => {
  if (!content) return null;

  const lines = content.split("\n");
  const blocks: Array<{ type: "table" | "header" | "subheader" | "list" | "text" | "divider"; data: any }> = [];

  let inTable = false;
  let tableRows: string[][] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();

    // A. 检测表格行 (| Col1 | Col2 |)
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      // 忽略 Markdown 表格分割线 (|---|---|)
      if (trimmed.includes("---")) {
        return;
      }
      inTable = true;
      const cols = trimmed
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      tableRows.push(cols);
      return;
    } else {
      if (inTable && tableRows.length > 0) {
        blocks.push({ type: "table", data: [...tableRows] });
        tableRows = [];
        inTable = false;
      }
    }

    // B. 分割线
    if (trimmed === "---" || trimmed === "***") {
      blocks.push({ type: "divider", data: null });
      return;
    }

    // C. 标题
    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "header", data: trimmed.replace(/^##\s+/, "") });
      return;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "subheader", data: trimmed.replace(/^###\s+/, "") });
      return;
    }

    // D. 无序列表
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      blocks.push({ type: "list", data: trimmed.replace(/^[-*]\s+/, "") });
      return;
    }

    // E. 普通文本
    if (trimmed.length > 0) {
      blocks.push({ type: "text", data: trimmed });
    }
  });

  // 处理末尾未挂载的表格
  if (inTable && tableRows.length > 0) {
    blocks.push({ type: "table", data: [...tableRows] });
  }

  // 渲染单行文本中的粗体语法 **粗体**
  const renderInlineFormattedText = (text: string, baseStyle: string = "text-xs text-ink") => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return (
      <Text className={baseStyle}>
        {parts.map((part, idx) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <Text key={idx} className="font-black text-brand">
                {part.slice(2, -2)}
              </Text>
            );
          }
          return part;
        })}
      </Text>
    );
  };

  return (
    <View className="space-y-2.5">
      {blocks.map((block, i) => {
        if (block.type === "header") {
          return (
            <View key={i} className="mt-2 mb-1 pb-1 border-b border-line">
              <Text className="text-sm font-black text-ink">{block.data}</Text>
            </View>
          );
        }

        if (block.type === "subheader") {
          return (
            <Text key={i} className="text-xs font-black text-brand mt-1 mb-0.5">
              {block.data}
            </Text>
          );
        }

        if (block.type === "divider") {
          return <View key={i} className="h-[1px] bg-line my-2" />;
        }

        if (block.type === "list") {
          return (
            <View key={i} className="flex-row items-start gap-1.5 ml-1">
              <Text className="text-xs font-black text-brand mt-0.5">•</Text>
              <View className="flex-1">{renderInlineFormattedText(block.data, "text-xs leading-5 text-ink")}</View>
            </View>
          );
        }

        if (block.type === "table") {
          const headerRow = block.data[0] || [];
          const bodyRows = block.data.slice(1);

          return (
            <View key={i} className="my-2 rounded-2xl overflow-hidden border border-line shadow-xs bg-surface">
              {/* 表头 */}
              <View className="flex-row bg-brand-fill px-3 py-2">
                {headerRow.map((col: string, colIdx: number) => (
                  <View key={colIdx} className="flex-1 items-center justify-center px-1">
                    <Text className="text-[11px] font-black text-white text-center">{col}</Text>
                  </View>
                ))}
              </View>

              {/* 表格体 */}
              {bodyRows.map((row: string[], rowIdx: number) => (
                <View
                  key={rowIdx}
                  className={`flex-row px-3 py-2 border-t border-line/60 ${
                    rowIdx % 2 === 1 ? "bg-canvas" : "bg-surface"
                  }`}
                >
                  {row.map((colText: string, colIdx: number) => (
                    <View key={colIdx} className="flex-1 items-center justify-center px-1">
                      {renderInlineFormattedText(colText, "text-[11px] font-bold text-ink text-center")}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          );
        }

        return (
          <View key={i} className="leading-6">
            {renderInlineFormattedText(block.data, "text-xs leading-6 text-ink")}
          </View>
        );
      })}
    </View>
  );
};
