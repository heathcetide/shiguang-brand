# restrict-linear-gradient 技术设计

## 目标
- 禁止在 backgroundColor 中使用 linear-gradient 字符串
- 覆盖 StyleSheet.create 与 JSX style 的常见写法
- 实现轻量、易维护，不引入新依赖

## 规则命名与对外形态
- 插件目录：expo/eslint-plugins/restrict-linear-gradient
- 规则名：restrict-linear-gradient/no-linear-gradient-backgroundcolor
- 规则类型：problem
- 默认等级：error

## 规则行为定义
### 报错
当以下任一位置出现 backgroundColor 且值包含 linear-gradient( 时，报错：
- StyleSheet.create 的样式对象中
- JSX 元素 style 属性内的对象或数组成员

### 不报错
以下场景不触发：
- 非 backgroundColor 的属性
- backgroundColor 的非字符串值
- 模板字符串包含表达式的动态值
- 与 style 无关的对象字面量

## 检测策略
### StyleSheet.create
遍历 StyleSheet.create 的首个参数对象，检查：
- 顶层 backgroundColor
- 每个样式项对应的对象内的 backgroundColor

### JSX style
定位 JSXAttribute(name=style) 后，检查表达式：
- ObjectExpression
- ArrayExpression 的各元素
- StyleSheet.flatten / StyleSheet.compose 的参数

## 线性渐变识别
使用正则 /linear-gradient/i 检测字符串字面量与模板字符串静态片段。

## 报错信息
- messageId: noLinearGradientBackgroundColor
- 文案：backgroundColor 和 linear-gradient 无法一起使用，请将 backgroundColor 改为 experimental_backgroundImage

## 典型示例
### 触发
- StyleSheet.create({ a: { backgroundColor: 'linear-gradient(135deg,#F97316 0%,#FB923C 100%)' } })
- <View style={{ backgroundColor: "linear-gradient(135deg,#F97316 0%,#FB923C 100%)" }} />
- <View style={[{ backgroundColor: `linear-gradient(135deg,#F97316 0%,#FB923C 100%)` }]} />

### 不触发
- { background: 'linear-gradient(...)' }
- { backgroundColor: someVar }

## 性能考虑
- 仅扫描目标节点与静态字符串
- 早返回空节点与非字符串值
