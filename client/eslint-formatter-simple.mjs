export default function (results) {
  
  return results
    .flatMap(file =>
      file.messages.map(m => {
        // split into lines
        const lines = m.message.split('\n');

        // 第一行（句子）：直接用
        const first = lines[0];

        // 附加解释：过滤掉所有 codeframe/箭头/行号/重复路径
        const details = lines
          .slice(1)
          .filter(l => {
            // 移除空行
            if (!l.trim()) return false;

            // 移除 "58 | xxx" 这样的行
            if (/^\s*\d+\s*\|/.test(l)) return false;

            // 移除 "> 60 | ..." 这样的箭头行
            if (/^\s*>/.test(l)) return false;

            // 移除只有箭头提示的行，如 "| ^^^^^"
            if (/^\s*\|/.test(l)) return false;

            // 移除 "…" 省略号行
            if (/^\s*…/.test(l)) return false;

            // 移除重复路径行（eslint message 有时夹带 file:line）
            if (/\.tsx:\d+:\d+/.test(l)) return false;

            return true;
          })
          .join('\n')
          .trim();

        let output = `${file.filePath}:${m.line}:${m.column}  ${
          m.severity === 2 ? 'error' : 'warn'
        }  ${first}`;

        if (details) output += `\n${details}\n`;

        return output;
      })
    )
    .join('\n');
};