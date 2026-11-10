module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止带有 horizontal: true 属性的 ScrollView 单独使用',
      recommended: false,
    },
    schema: [],
    messages: {
      noSiblings: '禁止带有 props.horizontal: true 的 ScrollView 单独使用，需要在 ScrollView 外层使用一个单独的 View 组件进行包裹',
    },
  },
  create(context) {
    return {
      JSXElement(node) {
        const isScrollView = node.openingElement.name.name === 'ScrollView';

        if (!isScrollView) {
          return;
        }

        const hasHorizontalProp = node.openingElement.attributes.some(attr => {
          if (attr.type === 'JSXAttribute' && attr.name.name === 'horizontal') {
            if (!attr.value) {
              return true;
            }
            if (
              attr.value.type === 'JSXExpressionContainer' &&
              attr.value.expression.value === true
            ) {
              return true; // horizontal={true}
            }
            if (attr.value.type === 'Literal' && attr.value.value === true) {
              return true; // horizontal={true} 的另一种形式
            }
          }
          return false;
        });

        if (!hasHorizontalProp) {
          return;
        }

        const parent = node.parent;

        if (
          parent.type === 'JSXFragment' ||
          parent.type === 'JSXElement'
        ) {
          const siblings = parent.children.filter(
            child => child.type === 'JSXElement' && child !== node
          );

          if (siblings.length > 0) {
            context.report({
              node,
              messageId: 'noSiblings',
            });
          }
        }
      },
    };
  },
}
