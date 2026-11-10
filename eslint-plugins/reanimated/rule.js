module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow passing useAnimatedScrollHandler return value to ScrollView',
      recommended: 'error',
    },
    schema: [],
    messages: {
      noUseAnimatedScrollHandlerOnScroll:
        'Do not pass useAnimatedScrollHandler return value to ScrollView, pass to Animated.ScrollView instead.',
    },
  },

  create(context) {
    // 记录 useAnimatedScrollHandler 的本地名字
    let useAnimatedScrollHandlerImportName = null;
    // 记录 ScrollView 的本地名字
    let scrollViewImportName = null;
    // 记录调用 useAnimatedScrollHandler 返回值的变量名
    const animatedScrollHandlerVars = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value === 'react-native-reanimated') {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.name === 'useAnimatedScrollHandler'
            ) {
              useAnimatedScrollHandlerImportName = specifier.local.name;
            }
          }
        }

        if (node.source.value === 'react-native') {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.name === 'ScrollView'
            ) {
              scrollViewImportName = specifier.local.name;
            }
          }
        }
      },

      VariableDeclarator(node) {
        if (
          node.init &&
          node.init.type === 'CallExpression' &&
          node.init.callee.type === 'Identifier' &&
          node.init.callee.name === useAnimatedScrollHandlerImportName
        ) {
          if (node.id.type === 'Identifier') {
            animatedScrollHandlerVars.add(node.id.name);
          }
        }
      },

      JSXOpeningElement(node) {
        if (
          node.name.type === 'JSXIdentifier' &&
          node.name.name === scrollViewImportName
        ) {
          for (const attr of node.attributes) {
            if (
              attr.type === 'JSXAttribute' &&
              attr.name.name === 'onScroll' &&
              attr.value &&
              attr.value.type === 'JSXExpressionContainer' &&
              attr.value.expression.type === 'Identifier'
            ) {
              const varName = attr.value.expression.name;
              if (animatedScrollHandlerVars.has(varName)) {
                context.report({
                  node: attr,
                  messageId: 'noUseAnimatedScrollHandlerOnScroll',
                });
              }
            }
          }
        }
      },
    };
  },
};
