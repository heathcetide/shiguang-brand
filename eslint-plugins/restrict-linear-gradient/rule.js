const LINEAR_GRADIENT_RE = /linear-gradient/i

function getPropertyKeyName(property) {
  if (!property || property.type !== 'Property') return null
  if (property.key.type === 'Identifier') return property.key.name
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
    return property.key.value
  }
  return null
}

function getStaticStringValue(node) {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map(quasi => quasi.value?.cooked || '').join('')
  }
  return null
}

function isLinearGradientString(text) {
  if (!text) return false
  return LINEAR_GRADIENT_RE.test(text)
}

function checkStyleObjectExpression(objectExpression, report) {
  if (!objectExpression || objectExpression.type !== 'ObjectExpression') return
  for (const property of objectExpression.properties) {
    if (!property || property.type !== 'Property') continue
    const keyName = getPropertyKeyName(property)
    if (keyName !== 'backgroundColor') continue
    const valueText = getStaticStringValue(property.value)
    if (isLinearGradientString(valueText)) {
      report(property.key || property)
    }
  }
}

function isStyleSheetMethodCall(node, methodName) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression') return false
  if (callee.object.type !== 'Identifier' || callee.object.name !== 'StyleSheet') return false
  if (callee.property.type === 'Identifier') return callee.property.name === methodName
  return false
}

function checkStyleExpression(expression, report) {
  if (!expression) return
  if (expression.type === 'ObjectExpression') {
    checkStyleObjectExpression(expression, report)
    return
  }
  if (expression.type === 'ArrayExpression') {
    for (const element of expression.elements) {
      if (!element) continue
      if (element.type === 'SpreadElement') {
        checkStyleExpression(element.argument, report)
      } else {
        checkStyleExpression(element, report)
      }
    }
    return
  }
  // 例：StyleSheet.flatten([styles.a, { backgroundColor: 'linear-gradient(...)' }])
  if (isStyleSheetMethodCall(expression, 'flatten')) {
    const arg = expression.arguments[0]
    checkStyleExpression(arg, report)
    return
  }
  // 例：StyleSheet.compose(styles.a, { backgroundColor: `linear-gradient(${angle},#fff,#000)` })
  if (isStyleSheetMethodCall(expression, 'compose')) {
    const [first, second] = expression.arguments
    checkStyleExpression(first, report)
    checkStyleExpression(second, report)
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow linear-gradient string in backgroundColor',
      recommended: 'error',
    },
    schema: [],
    messages: {
      noLinearGradientBackgroundColor:
        'backgroundColor 和 linear-gradient 无法一起使用，请将 backgroundColor 改为 experimental_backgroundImage',
    },
  },

  create(context) {
    function report(node) {
      context.report({ node, messageId: 'noLinearGradientBackgroundColor' })
    }

    return {
      CallExpression(node) {
        if (!isStyleSheetMethodCall(node, 'create')) return
        const firstArg = node.arguments[0]
        if (!firstArg || firstArg.type !== 'ObjectExpression') return

        checkStyleObjectExpression(firstArg, report)

        for (const property of firstArg.properties) {
          if (!property || property.type !== 'Property') continue
          if (!property.value || property.value.type !== 'ObjectExpression') continue
          checkStyleObjectExpression(property.value, report)
        }
      },

      JSXAttribute(node) {
        if (!node.name || node.name.name !== 'style') return
        if (!node.value || node.value.type !== 'JSXExpressionContainer') return
        checkStyleExpression(node.value.expression, report)
      },
    }
  },
}
