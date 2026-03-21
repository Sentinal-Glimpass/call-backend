const pinoHttp = require('pino-http');
const crypto = require('crypto');
const logger = require('../utils/logger');

// Paths to skip logging entirely (health checks, probes)
const SKIP_PATHS = new Set([
  '/health', '/health/liveness', '/health/readiness',
  '/health/container', '/health/detailed', '/health/cloud-run',
  '/health/heartbeats', '/health/concurrency', '/health/comprehensive',
  '/health/database', '/health/database/validate', '/health/performance',
  '/health/integration-test',
  '/', '/warmup', '/favicon.ico'
]);

// High-volume webhook paths — sampled to reduce volume
const SAMPLED_PATHS = new Set([
  '/plivo/callback-url', '/plivo/ring-url', '/plivo/hangup-url',
  '/plivo/callback-record-url',
  '/twilio/callback-url', '/twilio/status-callback',
  '/exotel/callback-url'
]);

const SAMPLE_RATE = parseFloat(process.env.LOG_SAMPLE_RATE) || 0.1;

function shouldLog(req) {
  const path = req.url.split('?')[0];
  if (SKIP_PATHS.has(path)) return false;
  if (SAMPLED_PATHS.has(path)) return Math.random() < SAMPLE_RATE;
  return true;
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const sanitized = { ...body };
  for (const key of ['password', 'apiKey', 'token', 'secret']) {
    if (sanitized[key]) sanitized[key] = '[REDACTED]';
  }
  if (sanitized.user && sanitized.user.apiKey) {
    sanitized.user = { ...sanitized.user, apiKey: '[REDACTED]' };
  }
  return sanitized;
}

const apiLogger = pinoHttp({
  logger: logger,

  // Request ID from Cloud Run trace header or random UUID
  genReqId: (req) => {
    return req.headers['x-request-id'] ||
      req.headers['x-cloud-trace-context']?.split('/')[0] ||
      crypto.randomUUID();
  },

  // Skip health checks and sample webhooks
  autoLogging: {
    ignore: (req) => !shouldLog(req)
  },

  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },

  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  },

  // Minimal request/response serialization
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },

  // Add context — include body only on errors
  customProps: (req, res) => {
    const props = {
      userId: req.user?.clientId || null,
      userEmail: req.user?.email || null,
      ip: req.ip || req.connection?.remoteAddress,
    };

    // On 4xx/5xx errors, include request body for debugging
    if (res.statusCode >= 400) {
      props.requestBody = sanitizeBody(req.body);
    }

    return props;
  },

  customAttributeKeys: {
    reqId: 'requestId'
  }
});

// Lightweight request counter
let requestCount = 0;
let lastResetTime = Date.now();

const requestCounter = (req, res, next) => {
  requestCount++;
  const now = Date.now();
  if (now - lastResetTime > 3600000) {
    logger.info({ hourlyRequestCount: requestCount }, 'Hourly request stats');
    requestCount = 0;
    lastResetTime = now;
  }
  next();
};

module.exports = { apiLogger, requestCounter };
