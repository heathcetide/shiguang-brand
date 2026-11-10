const validName = require('./rule')

const plugin = {
  rules: {
    'valid-name': validName,
  },
};

module.exports = plugin