const names = require('./names')
const v5OnlyNames = require('./v5-only-names')
const v5OnlyNamesSet = new Set(v5OnlyNames)

const DEFAULTS = {
  whitelist: names,
  componentName: 'FontAwesome6',
  attributeName: 'name',
};

function getJSXAttribute(openingElement, attrName) {
  return openingElement.attributes.find(
    (attr) =>
      attr &&
      attr.type === 'JSXAttribute' &&
      attr.name &&
      attr.name.name === attrName
  );
}

function getStringLiteralValue(attribute) {
  if (!attribute || !attribute.value) return null;

  const val = attribute.value;

  // <Comp name="hello" />
  if (val.type === 'Literal' && typeof val.value === 'string') {
    return val.value;
  }

  // <Comp name={'hello'} />
  if (
    val.type === 'JSXExpressionContainer' &&
    val.expression &&
    val.expression.type === 'Literal' &&
    typeof val.expression.value === 'string'
  ) {
    return val.expression.value;
  }

  // <Comp name={`hello`} /> template literal without expressions
  if (
    val.type === 'JSXExpressionContainer' &&
    val.expression &&
    val.expression.type === 'TemplateLiteral' &&
    val.expression.expressions.length === 0
  ) {
    return val.expression.quasis[0]?.value?.cooked ?? null;
  }

  return null;
}

const replacements = {
  'plus-circle': 'circle-plus',
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ensure FontAwesome6 name prop is a string literal in whitelist',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          whitelist: {
            type: 'array',
            items: { type: 'string' },
            default: DEFAULTS.whitelist,
          },
          componentName: {
            type: 'string',
            default: DEFAULTS.componentName,
          },
          attributeName: {
            type: 'string',
            default: DEFAULTS.attributeName,
          },
          caseSensitive: {
            type: 'boolean',
            default: true
          }
        },
      },
    ],
    messages: {
      invalidName:
        '{{componentName}} 中不存在图标 {{name}}，{{suggestion}}',
    },
  },

  create(context) {
    const options = context.options && context.options[0] ? context.options[0] : {};
    const componentName = options.componentName || DEFAULTS.componentName;
    const attributeName = options.attributeName || DEFAULTS.attributeName;
    const caseSensitive = options.caseSensitive ?? true;

    const whitelistRaw = Array.isArray(options.whitelist)
      ? options.whitelist
      : DEFAULTS.whitelist;

    const normalize = (s) =>
      caseSensitive ? String(s) : String(s).toLowerCase();

    const whitelist = new Set(whitelistRaw.map(normalize));

    function isTargetComponent(node) {
      // Supports: <FontAwesome6 />, <NS.FontAwesome6 />
      const nameNode = node.name;
      if (!nameNode) return false;

      if (nameNode.type === 'JSXIdentifier') {
        return nameNode.name === componentName;
      }

      if (nameNode.type === 'JSXMemberExpression') {
        // e.g., UI.FontAwesome6
        let base = nameNode;
        while (base.type === 'JSXMemberExpression') {
          if (base.property && base.property.name === componentName) {
            return true;
          }
          base = base.object;
        }
      }

      return false;
    }

    return {
      JSXOpeningElement(opening) {
        if (!isTargetComponent(opening)) return;

        const attrNode = getJSXAttribute(opening, attributeName);
        if (!attrNode) return;

        const literal = getStringLiteralValue(attrNode);

        // Only lint when it's a string literal
        if (literal == null) return;

        const normalized = normalize(literal);
        if (!whitelist.has(normalized)) {
          context.report({
            node: attrNode.value || attrNode,
            messageId: 'invalidName',
            data: {
              componentName,
              name: literal,
              suggestion: getSuggestion(normalized, literal),
            },
          });
        }
      },
    };
  },
};

function getSuggestion(name, originalName) {
  if (replacements[name]) {
    return `请更换为 ${replacements[name]}`
  }

  if (v5OnlyNamesSet.has(name)) {
    return `${originalName} 只能和 FontAwesome5 组件一起使用`
  }

  return '请更换为其他图标'
}
