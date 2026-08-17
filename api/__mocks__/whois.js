// Mock manuel — le package whois utilise ESM (import) incompatible avec Jest CommonJS
module.exports = {
  lookup: jest.fn((domain, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
    }
    callback(null, 'creation date: 2020-01-01T00:00:00Z');
  }),
};
