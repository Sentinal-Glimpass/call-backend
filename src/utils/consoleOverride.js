const logger = require('./logger');

// console.log (820 calls) → debug level → suppressed in production
console.log = (...args) => {
  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  logger.debug({ source: 'console.log' }, message);
};

// console.error (605 calls) → error level → always visible
console.error = (...args) => {
  const message = args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') return JSON.stringify(a);
    return String(a);
  }).join(' ');
  logger.error({ source: 'console.error' }, message);
};

// console.warn (54 calls) → warn level → always visible
console.warn = (...args) => {
  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  logger.warn({ source: 'console.warn' }, message);
};

console.info = (...args) => {
  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  logger.info({ source: 'console.info' }, message);
};
