const DEFAULTS = {
  ignorePatterns: [],
}

const RE_EMOJI =
  // 匹配完整 emoji 序列：基础图形 + 可选变体选择符/肤色 + 可选 ZWJ 连接序列；以及国旗与 keycap
  /(?:\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?)*)|(?:[\u{1F1E6}-\u{1F1FF}]{2})|(?:[#*0-9]\uFE0F?\u20E3)/gu

function buildIgnoreRegexes(patterns) {
  if (!Array.isArray(patterns)) return []
  const result = []
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue
    try {
      result.push(new RegExp(pattern))
    } catch (_) {
      continue
    }
  }
  return result
}

function shouldIgnore(text, ignoreRegexes) {
  if (!ignoreRegexes.length) return false
  for (const re of ignoreRegexes) {
    if (re.test(text)) return true
  }
  return false
}

function hasEmoji(text) {
  if (!text) return false
  RE_EMOJI.lastIndex = 0
  return RE_EMOJI.test(text)
}

function collectEmojis(text) {
  if (!text) return []
  RE_EMOJI.lastIndex = 0
  const result = []
  const seen = new Set()
  for (const match of text.matchAll(RE_EMOJI)) {
    if (match[0] && !seen.has(match[0])) {
      seen.add(match[0])
      result.push(match[0])
    }
  }
  return result
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow emoji in code',
      recommended: 'error',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          ignorePatterns: {
            type: 'array',
            items: { type: 'string' },
            default: DEFAULTS.ignorePatterns,
          },
        },
      },
    ],
    messages: {
      noEmoji: '禁止在代码中使用 emoji：{{emojis}}，请移除或者使用 @expo/vector-icons 图标',
    },
  },

  create(context) {
    const options = context.options && context.options[0] ? context.options[0] : {}
    const ignoreRegexes = buildIgnoreRegexes(
      Array.isArray(options.ignorePatterns) ? options.ignorePatterns : DEFAULTS.ignorePatterns
    )

    function checkText(node, text) {
      if (!text) return
      if (shouldIgnore(text, ignoreRegexes)) return
      if (hasEmoji(text)) {
        const emojis = collectEmojis(text)
        const emojiText = emojis.length ? emojis.join(' ') : ''
        context.report({ node, messageId: 'noEmoji', data: { emojis: emojiText } })
      }
    }

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return
        checkText(node, node.value)
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          const cooked = quasi.value && typeof quasi.value.cooked === 'string'
            ? quasi.value.cooked
            : quasi.value && typeof quasi.value.raw === 'string'
              ? quasi.value.raw
              : ''
          checkText(quasi, cooked)
        }
      },
      JSXText(node) {
        checkText(node, node.value)
      },
    }
  },
}
