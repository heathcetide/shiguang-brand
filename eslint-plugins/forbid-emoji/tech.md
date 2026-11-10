# forbid-emoji 技术设计

## 目标
- 在代码中检测并禁止使用 emoji
- 覆盖常见的字符串与 JSX 场景，避免明显漏报
- 保持实现简单、可维护，避免引入新依赖

## 规则命名与对外形态
- 插件目录：demo/eslint-plugins/forbid-emoji
- 规则名：forbid-emoji/no-emoji
- 规则类型：problem
- 默认等级：error

## 规则行为定义
### 报错
当以下任一位置包含 emoji 时，报错：
- 字符串字面量
- 模板字符串的静态片段
- JSXText 文本
- JSXAttribute 中可静态解析为字符串的值

### 不报错
以下场景不触发：
- 标识符、对象键名、属性名中的字符
- 数值、正则字面量、BigInt
- 模板字符串的表达式部分（仅检测静态片段）
- 被用户显式忽略的路径或内容

## 配置项
```json
{
  "ignorePatterns": []
}
```
- ignorePatterns：字符串数组，命中任一正则则跳过该文本片段

## 检测策略
### AST 访问节点
- Literal：仅处理 typeof value === 'string'
- TemplateLiteral：遍历 quasis，使用 cooked 值
- JSXText：使用 node.value
- JSXAttribute：可静态解析为字符串时处理

### 忽略策略
当文本命中 ignorePatterns 的任一正则时，不再做 emoji 检测，减少误报与白名单配置成本。

## Emoji 识别方案
### 组合序列处理
考虑到真实文本中的 emoji 组合形式，需要识别以下组合序列并保证命中：
- 变体选择符：U+FE0F
- 皮肤色修饰符：U+1F3FB–U+1F3FF
- ZWJ 组合：U+200D
- 区域指示符组成的国旗：U+1F1E6–U+1F1FF 的成对序列
- Keycap 组合：[#*0-9] + U+FE0F? + U+20E3

实现上直接使用完整序列正则匹配，覆盖 ZWJ 连接序列、国旗与 keycap。

### 正则示意
```
const RE_EMOJI =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?)*)|(?:[\u{1F1E6}-\u{1F1FF}]{2})|(?:[#*0-9]\uFE0F?\u20E3)/gu
```
命中即判定为 emoji。

## 报错信息
- messageId: noEmoji
- 文案：禁止在代码中使用 emoji

## 典型示例
### 触发
- "hello🙂"
- `title: "Nice 👍"`
- <Text>欢迎🎉</Text>

### 不触发
- const icon = "face-smile"
- <Text>{user.name}</Text>
- "hello" + emojiName

## 边界与决策
- 模板字符串表达式部分：不深入解析，避免执行风险与复杂度
- 正则字面量：不扫描，避免干扰正则语义
- 注释：默认不扫描
- 误报控制：提供 ignorePatterns，由使用者按文件或内容片段进行排除

## 性能考虑
- 仅在字符串节点上进行扫描
- 正则预编译并复用
- 对空字符串与短文本快速返回

## 测试计划
- 覆盖 Literal、TemplateLiteral、JSXText、JSXAttribute 四类节点
- 覆盖 ZWJ 组合、变体选择符、国旗、keycap、皮肤色修饰符
- 覆盖 ignorePatterns 行为
