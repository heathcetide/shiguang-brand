function normalizeFilename(filename) {
  // ESLint may provide Windows paths; normalize to forward slashes for suffix checks.
  return typeof filename === 'string' ? filename.replace(/\\/g, '/') : ''
}

function isTargetLayoutFile(context) {
  return normalizeFilename(context.getFilename()).endsWith('/app/_layout.tsx')
}

function isSideEffectImportOf(node, sourceValue) {
  return (
    node &&
    node.type === 'ImportDeclaration' &&
    node.source &&
    node.source.type === 'Literal' &&
    node.source.value === sourceValue &&
    Array.isArray(node.specifiers) &&
    node.specifiers.length === 0
  )
}

function getProviderImportLocalName(node) {
  if (
    !node ||
    node.type !== 'ImportDeclaration' ||
    !node.source ||
    node.source.type !== 'Literal' ||
    node.source.value !== '@/components/Provider'
  ) {
    return null
  }

  const specifiers = Array.isArray(node.specifiers) ? node.specifiers : []
  if (specifiers.length !== 1) return null
  const [specifier] = specifiers
  if (specifier.type !== 'ImportSpecifier') return null
  if (!specifier.imported || specifier.imported.type !== 'Identifier') return null
  if (!specifier.local || specifier.local.type !== 'Identifier') return null

  // Allow `import { Provider } ...` and `import { Provider as XXX } ...`
  if (specifier.imported.name !== 'Provider') return null
  return specifier.local.name
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require global.css import and Provider usage in app/_layout.tsx',
      recommended: 'error',
    },
    schema: [],
    messages: {
      missingGlobalCssImport: `app/_layout.tsx 必须引入 global.css 文件（参考写法：import '../global.css'）`,
      requireProviderImportAndUsage:
        "app/_layout.tsx 必须从 @/components/Provider 导入 Provider（参考写法：import { Provider } from '@/components/Provider'），并使用导入的 Provider 包裹其余组件",
    },
  },

  create(context) {
    if (!isTargetLayoutFile(context)) {
      return {}
    }

    let hasGlobalCssImport = false
    let providerImportLocalName = null
    let hasProviderJsxUsage = false

    return {
      Program(node) {
        const body = Array.isArray(node.body) ? node.body : []
        for (const stmt of body) {
          if (isSideEffectImportOf(stmt, '../global.css')) {
            hasGlobalCssImport = true
          }
          const localName = getProviderImportLocalName(stmt)
          if (localName) {
            providerImportLocalName = localName
          }
        }
      },

      JSXOpeningElement(node) {
        if (!node || !node.name) return
        if (
          providerImportLocalName &&
          node.name.type === 'JSXIdentifier' &&
          node.name.name === providerImportLocalName
        ) {
          hasProviderJsxUsage = true
        }
      },

      'Program:exit'(node) {
        if (!hasGlobalCssImport) {
          context.report({ node, messageId: 'missingGlobalCssImport' })
        }

        if (!providerImportLocalName || !hasProviderJsxUsage) {
          context.report({ node, messageId: 'requireProviderImportAndUsage' })
        }
      },
    }
  },
}
