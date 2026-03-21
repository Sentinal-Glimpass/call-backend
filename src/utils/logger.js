const pino = require('pino');

const LOG_LEVEL = process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const logger = pino({
  level: LOG_LEVEL,

  // Cloud Logging severity mapping
  formatters: {
    level(label, number) {
      const severityMap = {
        trace: 'DEBUG',
        debug: 'DEBUG',
        info: 'INFO',
        warn: 'WARNING',
        error: 'ERROR',
        fatal: 'CRITICAL'
      };
      return {
        severity: severityMap[label] || 'DEFAULT',
        level: number
      };
    }
  },

  // Redact sensitive fields
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'apiKey',
      'token',
      '*.password',
      '*.apiKey',
      '*.token',
      '*.secret'
    ],
    censor: '[REDACTED]'
  },

  // Pretty print in dev, raw JSON in production
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' }
  } : undefined,

  base: {
    service: 'call-backend',
    env: process.env.NODE_ENV || 'development'
  },

  timestamp: pino.stdTimeFunctions.isoTime
});

module.exports = logger;
