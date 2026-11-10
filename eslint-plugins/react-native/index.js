const wrapScrollViewInView = require('./rule')

const plugin = {
  rules: {
    'wrap-horizontal-scrollview-inside-view': wrapScrollViewInView,
  },
};

module.exports = plugin
