const fs = require('fs').promises;
const path = require('path');

// Enhanced API request/response logger
const apiLogger = (req, res, next) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  // Capture the original response methods
  const originalSend = res.send;
  const originalJson = res.json;
  
  let responseData = null;
  let statusCode = 200;
  
  // Override res.send to capture response data
  res.send = function(body) {
    responseData = body;
    statusCode = res.statusCode || 200;
    return originalSend.call(this, body);
  };
  
  // Override res.json to capture JSON response data
  res.json = function(body) {
    responseData = body;
    statusCode = res.statusCode || 200;
    return originalJson.call(this, body);
  };
  
  // When response finishes, log the complete request/response
  res.on('finish', async () => {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Sanitize sensitive data for logging
    const sanitizedBody = sanitizeRequestBody(req.body, req.path);
    const sanitizedResponse = sanitizeResponseData(responseData, req.path);
    
    const logEntry = {
      timestamp,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent') || 'Unknown',
      method: req.method,
      path: req.path,
      url: req.originalUrl,
      statusCode,
      duration: `${duration}ms`,
      request: {
        headers: sanitizeHeaders(req.headers),
        query: req.query,
        body: sanitizedBody,
        params: req.params
      },
      response: {
        data: sanitizedResponse,
        headers: sanitizeHeaders(res.getHeaders())
      },
      user: req.user ? {
        clientId: req.user.clientId,
        email: req.user.email,
        company: req.user.company,
        tokens: req.user.tokens
      } : null,
      auth: {
        hasToken: !!req.headers.authorization,
        tokenType: req.headers.authorization ? req.headers.authorization.split(' ')[0] : null
      },
      performance: {
        durationMs: duration,
        category: categorizeDuration(duration)
      }
    };
    
    // Log to console with formatted output
    logToConsole(logEntry);
    
    // Also log to file for persistence (optional)
    logToFile(logEntry).catch(err => {
      console.error('Failed to log to file:', err.message);
    });
  });
  
  next();
};

// Sanitize request body to remove sensitive data
function sanitizeRequestBody(body, path) {
  if (!body || typeof body !== 'object') return body;
  
  const sanitized = { ...body };
  
  // Remove passwords from all requests
  if (sanitized.password) {
    sanitized.password = '[REDACTED]';
  }
  
  // Remove API keys
  if (sanitized.apiKey) {
    sanitized.apiKey = '[REDACTED]';
  }
  
  // Remove sensitive tokens
  if (sanitized.token && typeof sanitized.token === 'string') {
    sanitized.token = `[REDACTED-${sanitized.token.length} chars]`;
  }
  
  return sanitized;
}

// Sanitize response data
function sanitizeResponseData(data, path) {
  if (!data || typeof data !== 'object') return data;
  
  let sanitized;
  try {
    sanitized = typeof data === 'string' ? JSON.parse(data) : { ...data };
  } catch {
    return data; // Return as-is if not JSON
  }
  
  // Redact JWT tokens in responses
  if (sanitized.token && typeof sanitized.token === 'string') {
    sanitized.token = `[JWT-${sanitized.token.length} chars]`;
  }
  
  // Redact API keys in user objects
  if (sanitized.user && sanitized.user.apiKey) {
    sanitized.user.apiKey = '[REDACTED]';
  }
  
  return sanitized;
}

// Sanitize headers
function sanitizeHeaders(headers) {
  if (!headers) return {};
  
  const sanitized = { ...headers };
  
  // Redact authorization headers
  if (sanitized.authorization) {
    const parts = sanitized.authorization.split(' ');
    if (parts.length === 2) {
      sanitized.authorization = `${parts[0]} [REDACTED-${parts[1].length} chars]`;
    }
  }
  
  // Remove cookie headers for privacy
  if (sanitized.cookie) {
    sanitized.cookie = '[REDACTED]';
  }
  
  return sanitized;
}

// Categorize response duration
function categorizeDuration(duration) {
  if (duration < 100) return 'FAST';
  if (duration < 500) return 'NORMAL';
  if (duration < 2000) return 'SLOW';
  return 'VERY_SLOW';
}

// Format and log to console
function logToConsole(logEntry) {
  const { timestamp, method, path, statusCode, duration, user, ip } = logEntry;
  
  // Color coding for status codes
  const statusColor = getStatusColor(statusCode);
  const durationColor = getDurationColor(logEntry.performance.category);
  
  console.log('\n' + '='.repeat(80));
  console.log(`🕐 ${timestamp}`);
  console.log(`🌐 ${method} ${path} → ${statusColor}${statusCode}\x1b[0m (${durationColor}${duration}\x1b[0m)`);
  console.log(`📍 IP: ${ip} | User: ${user ? `${user.email} (${user.tokens} tokens)` : 'Anonymous'}`);
  
  // Request details
  if (Object.keys(logEntry.request.query).length > 0) {
    console.log(`📝 Query: ${JSON.stringify(logEntry.request.query)}`);
  }
  
  if (logEntry.request.body && Object.keys(logEntry.request.body).length > 0) {
    console.log(`📦 Request Body: ${JSON.stringify(logEntry.request.body, null, 2)}`);
  }
  
  // Response details (truncated for readability)
  if (logEntry.response.data) {
    const responseStr = JSON.stringify(logEntry.response.data, null, 2);
    const truncated = responseStr.length > 500 ? responseStr.substring(0, 500) + '...' : responseStr;
    console.log(`📤 Response: ${truncated}`);
  }
  
  // Performance and auth info
  console.log(`🔐 Auth: ${logEntry.auth.hasToken ? `✅ ${logEntry.auth.tokenType}` : '❌ No token'}`);
  console.log(`⚡ Performance: ${logEntry.performance.category} (${duration})`);
  console.log('='.repeat(80));
}

// Get color for status code
function getStatusColor(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return '\x1b[32m'; // Green
  if (statusCode >= 300 && statusCode < 400) return '\x1b[33m'; // Yellow
  if (statusCode >= 400 && statusCode < 500) return '\x1b[31m'; // Red
  if (statusCode >= 500) return '\x1b[35m'; // Magenta
  return '\x1b[0m'; // Reset
}

// Get color for duration
function getDurationColor(category) {
  switch (category) {
    case 'FAST': return '\x1b[32m'; // Green
    case 'NORMAL': return '\x1b[33m'; // Yellow
    case 'SLOW': return '\x1b[31m'; // Red
    case 'VERY_SLOW': return '\x1b[35m'; // Magenta
    default: return '\x1b[0m'; // Reset
  }
}

// Log to file for persistence
async function logToFile(logEntry) {
  try {
    const logDir = path.join(__dirname, '../../logs');
    await fs.mkdir(logDir, { recursive: true });
    
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `api-${date}.log`);
    
    const logLine = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(logFile, logLine);
  } catch (error) {
    // Don't throw - logging should never break the app
    console.error('File logging error:', error.message);
  }
}

// Request counter and rate monitoring
let requestCount = 0;
let lastResetTime = Date.now();

const requestCounter = (req, res, next) => {
  requestCount++;
  
  // Reset counter every hour
  const now = Date.now();
  if (now - lastResetTime > 3600000) { // 1 hour
    console.log(`📊 Hourly Stats: ${requestCount} requests processed`);
    requestCount = 0;
    lastResetTime = now;
  }
  
  next();
};

module.exports = {
  apiLogger,
  requestCounter
};