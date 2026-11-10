const requireGlobalCssAndProvider = require('./rule')

const plugin = {
  rules: {
    'require-globalcss-and-provider': requireGlobalCssAndProvider,
  },
}

module.exports = plugin
