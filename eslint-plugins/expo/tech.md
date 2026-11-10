# expo 技术设计（layout 规则）

## 目标
- 强约束 Expo Router 的 `app/_layout.tsx` 模板结构，避免初始化项目后被误删导致运行时样式/上下文缺失
- 校验 `app/_layout.tsx` 必须：
  - 包含 `import '../global.css'`
  - 使用从 `@/components/Provider` 导入的 Provider 组件作为 JSX 组件（允许 `import { Provider } ...` 或 `import { Provider as XXX } ...`）
- 实现轻量、易维护，不引入新依赖

## 规则命名与对外形态
- 插件目录：expo/eslint-plugins/expo
- 规则名：expo/require-globalcss-and-provider
- 规则类型：problem
- 默认等级：error

## 规则行为定义
### 报错
仅对目标文件 `app/_layout.tsx` 生效，满足以下任一情况报错：
- 缺少 side-effect import：`import '../global.css'`
- 缺少或不符合要求的 Provider 导入语句：
  - 必须从 `@/components/Provider` 导入
  - 必须为命名导入，导入名必须为 `Provider`
  - 允许形式：
    - `import { Provider } from '@/components/Provider';`
    - `import { Provider as XXX } from '@/components/Provider';`
- 未在 JSX 中使用导入的 Provider 组件（例如：只导入但从未作为 JSX 组件出现）

### 不报错
- 非 `app/_layout.tsx` 文件不做检查
- 目标文件同时满足：
  - 存在 `import '../global.css'`
  - 存在 Provider 命名导入（允许 as 别名）
  - JSX 中至少出现一次 `<Provider ...>` / `<Provider>` 或 `<XXX ...>` / `<XXX>`（XXX 为别名）

## 检测策略
### 目标文件判定
- 通过 `context.getFilename()` 获取当前文件路径
- 仅当路径以 `/app/_layout.tsx` 结尾时启用规则（同时兼容 Windows 路径分隔符做归一化）

### AST 访问节点
- `Program`：收集顶层 `ImportDeclaration`，判定是否存在目标 import
- `JSXOpeningElement` / `JSXElement`：判定是否使用 `<Provider>`

### Import 判定细则
- global.css：
  - `ImportDeclaration.source.value === '../global.css'`
  - `ImportDeclaration.specifiers.length === 0`（side-effect import）
- Provider import（严格形式）：
  - `ImportDeclaration.source.value === '@/components/Provider'`
  - `ImportDeclaration.specifiers` 仅包含一个 `ImportSpecifier`
  - `specifier.imported.name === 'Provider'`，`specifier.local.name` 允许为 `Provider` 或任意别名

## 报错信息
- messageId: missingGlobalCssImport
  - 文案：`app/_layout.tsx 必须包含 "import '../global.css';"`
- messageId: requireProviderImportAndUsage
  - 文案：`app/_layout.tsx 中必须从 @/components/Provider 导入 Provider（参考写法：import { Provider } from '@/components/Provider'），并使用导入的 Provider 包裹其余组件`

## 典型示例
### 触发
- 缺少 global.css：
  - 未包含 `import '../global.css';`
- Provider import 形式不对：
  - `import Provider from '@/components/Provider'`
  - `import { Provider } from '@/components/provider'`
- Provider 未使用：
  - 有 `import { Provider } ...`，但 JSX 中没有 `<Provider>`

### 不触发
```tsx
import { Provider } from '@/components/Provider';
import '../global.css';

export default function RootLayout() {
  return (
    <Provider>
      {/* ... */}
    </Provider>
  );
}
```

```tsx
import { Provider as AppProvider } from '@/components/Provider';
import '../global.css';

export default function RootLayout() {
  return (
    <AppProvider>
      {/* ... */}
    </AppProvider>
  );
}
```

## 边界与决策
- 仅做结构约束，不尝试自动修复（fixer）以避免在 TSX 顶部插入 import 引起格式与注释位置变化
- 仅检查 JSX 中的 `<Provider>` 使用，不做“必须最外层包裹”的结构分析，降低复杂度与误报

## 性能考虑
- 仅在命中目标文件时启用
- 仅扫描顶层 import 与 JSX 标签名，复杂度 O(n)

## 测试计划
- 缺少 global.css import：报 `missingGlobalCssImport`
- 未从 `@/components/Provider` 正确导入 Provider：报 `requireProviderImportAndUsage`
- Provider 未在 JSX 使用：报 `requireProviderImportAndUsage`
- 满足全部要求：不报错
