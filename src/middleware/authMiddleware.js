const jwt = require('jsonwebtoken');
const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');

// Progressive delay system for login attempts
const loginAttempts = new Map(); // In-memory store for login attempts

const antiAutomationDelay = async (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  // Get or initialize attempt data for this IP
  let attemptData = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
  
  // Calculate time since last attempt
  const timeSinceLastAttempt = now - attemptData.lastAttempt;
  
  // Reset counter if more than 5 minutes have passed
  if (timeSinceLastAttempt > 5 * 60 * 1000) {
    attemptData = { count: 0, lastAttempt: 0 };
  }
  
  // Calculate required delay based on attempt count
  let requiredDelay = 0;
  if (attemptData.count > 0) {
    // Progressive delay: 2s, 4s, 8s, 16s, 32s, then caps at 60s
    requiredDelay = Math.min(Math.pow(2, attemptData.count) * 1000, 60000);
  }
  
  // Check if enough time has passed since last attempt
  if (timeSinceLastAttempt < requiredDelay) {
    const remainingDelay = Math.ceil((requiredDelay - timeSinceLastAttempt) / 1000);
    return res.status(429).json({
      error: 'Please wait before trying again',
      message: `Please wait ${remainingDelay} seconds before your next login attempt`,
      retryAfter: remainingDelay,
      attemptNumber: attemptData.count + 1
    });
  }
  
  // Update attempt data
  attemptData.count += 1;
  attemptData.lastAttempt = now;
  loginAttempts.set(ip, attemptData);
  
  // Store attempt data in request for potential success handling
  req.loginAttemptData = attemptData;
  
  next();
};

// Clean up old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  
  for (const [ip, data] of loginAttempts.entries()) {
    if (data.lastAttempt < fiveMinutesAgo) {
      loginAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000);

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: 'Access token required',
        message: 'Please provide a valid authentication token'
      });
    }

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get fresh user data from database
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("client");
    
    const clientData = await collection.findOne({ 
      _id: new ObjectId(decoded.clientId) 
    });

    if (!clientData) {
      return res.status(403).json({ 
        error: 'Invalid token',
        message: 'User not found or token expired'
      });
    }

    // Add user data to request object
    req.user = {
      clientId: clientData._id.toString(),
      email: clientData.email,
      name: clientData.name,
      company: clientData.company,
      tokens: clientData.tokens || 0,
      isActive: clientData.isActive !== false
    };

    // Check if user is active
    if (!req.user.isActive) {
      return res.status(403).json({ 
        error: 'Account suspended',
        message: 'Your account has been suspended. Please contact support.'
      });
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Please login again to continue'
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ 
        error: 'Invalid token',
        message: 'Please provide a valid authentication token'
      });
    }
    
    console.error('Auth middleware error:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      message: 'Internal server error during authentication'
    });
  }
};

// Resource ownership validation
const validateResourceOwnership = (req, res, next) => {
  const clientIdFromBody = req.body.clientId;
  const clientIdFromParams = req.params.clientId;
  const clientIdFromQuery = req.query.clientId;
  
  // Get clientId from various sources
  const providedClientId = clientIdFromBody || clientIdFromParams || clientIdFromQuery;
  
  // If no clientId is provided in request, inject the authenticated user's clientId
  if (!providedClientId) {
    req.body.clientId = req.user.clientId;
    return next();
  }
  
  // If clientId is provided, validate ownership
  if (providedClientId !== req.user.clientId) {
    return res.status(403).json({ 
      error: 'Access denied',
      message: 'You can only access your own resources'
    });
  }
  
  next();
};

// Token balance checking and deduction
const checkTokenBalance = (cost = 1) => {
  return async (req, res, next) => {
    try {
      if (req.user.tokens < cost) {
        return res.status(402).json({ 
          error: 'Insufficient tokens',
          message: `This operation requires ${cost} tokens. You have ${req.user.tokens} tokens.`,
          tokensRequired: cost,
          tokensAvailable: req.user.tokens
        });
      }
      
      // Store the cost for potential deduction later
      req.operationCost = cost;
      next();
    } catch (error) {
      console.error('Token balance check error:', error);
      res.status(500).json({ 
        error: 'Token validation failed',
        message: 'Unable to validate token balance'
      });
    }
  };
};

// Deduct tokens after successful operation
const deductTokens = async (req, res, next) => {
  try {
    const cost = req.operationCost || 1;
    
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("client");
    
    // Deduct tokens atomically
    const result = await collection.updateOne(
      { 
        _id: new ObjectId(req.user.clientId),
        tokens: { $gte: cost } // Ensure sufficient balance
      },
      { 
        $inc: { tokens: -cost },
        $push: {
          tokenHistory: {
            operation: req.route.path,
            cost: cost,
            timestamp: new Date(),
            ip: req.ip,
            userAgent: req.get('User-Agent')
          }
        }
      }
    );
    
    if (result.modifiedCount === 0) {
      return res.status(402).json({ 
        error: 'Token deduction failed',
        message: 'Insufficient balance or concurrent usage detected'
      });
    }
    
    // Update user object with new balance
    req.user.tokens -= cost;
    
    next();
  } catch (error) {
    console.error('Token deduction error:', error);
    res.status(500).json({ 
      error: 'Token deduction failed',
      message: 'Unable to deduct tokens'
    });
  }
};

// Reset login attempts on successful login
const resetLoginAttempts = (ip) => {
  loginAttempts.delete(ip);
};

// Audit logging middleware
const auditLog = async (req, res, next) => {
  try {
    const logEntry = {
      clientId: req.user?.clientId,
      email: req.user?.email,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date(),
      body: req.method === 'POST' ? req.body : undefined
    };
    
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const auditCollection = database.collection("audit_logs");
    
    // Don't await this - log asynchronously
    auditCollection.insertOne(logEntry).catch(error => {
      console.error('Audit log error:', error);
    });
    
    next();
  } catch (error) {
    // Don't fail the request if logging fails
    console.error('Audit logging error:', error);
    next();
  }
};

// Super Key Authentication middleware (for admin and bot operations)
const authenticateSuperKey = (req, res, next) => {
  try {
    // Debug logging for MCP endpoints
    if (req.path.includes('/mcp/')) {
      console.log(`🔐 [AUTH MIDDLEWARE] Path: ${req.path}`);
      console.log(`🔐 [AUTH MIDDLEWARE] Body at auth: ${JSON.stringify(req.body)}`);
      console.log(`🔐 [AUTH MIDDLEWARE] Body type: ${typeof req.body}`);
      console.log(`🔐 [AUTH MIDDLEWARE] Content-Length: ${req.headers['content-length']}`);
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Super key required',
        message: 'Please provide a valid super key for this operation'
      });
    }

    if (token !== process.env.SUPER_KEY) {
      return res.status(403).json({
        error: 'Invalid super key',
        message: 'The provided super key is invalid'
      });
    }

    // Add super key context to request
    req.superKeyAuth = true;

    next();
  } catch (error) {
    console.error('Super key auth error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: 'Internal server error during super key authentication'
    });
  }
};

// Dual authentication middleware (JWT or Super Key)
const authenticateJWTOrSuperKey = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide either JWT token or super key'
      });
    }

    // Check if it's a super key first
    if (token === process.env.SUPER_KEY) {
      req.superKeyAuth = true;
      return next();
    }

    // Otherwise, try JWT authentication
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get fresh user data from database
      await connectToMongo();
      const database = client.db("talkGlimpass");
      const collection = database.collection("client");

      const clientData = await collection.findOne({
        _id: new ObjectId(decoded.clientId)
      });

      if (!clientData) {
        return res.status(403).json({
          error: 'Invalid token',
          message: 'User not found or token expired'
        });
      }

      // Add user data to request object
      req.user = {
        clientId: clientData._id.toString(),
        email: clientData.email,
        name: clientData.name,
        company: clientData.company,
        tokens: clientData.tokens || 0,
        isActive: clientData.isActive !== false
      };

      // Check if user is active
      if (!req.user.isActive) {
        return res.status(403).json({
          error: 'Account suspended',
          message: 'Your account has been suspended. Please contact support.'
        });
      }

      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expired',
          message: 'Please login again to continue'
        });
      }
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(403).json({
          error: 'Invalid authentication',
          message: 'Please provide a valid JWT token or super key'
        });
      }
      throw jwtError;
    }
  } catch (error) {
    console.error('Dual auth middleware error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: 'Internal server error during authentication'
    });
  }
};

// Enhanced resource ownership validation for dual auth
const validateResourceOwnershipDual = (req, res, next) => {
  // If super key is used, skip ownership validation
  if (req.superKeyAuth) {
    return next();
  }

  // For JWT users, validate ownership as usual
  const clientIdFromBody = req.body.clientId;
  const clientIdFromParams = req.params.clientId;
  const clientIdFromQuery = req.query.clientId;

  const providedClientId = clientIdFromBody || clientIdFromParams || clientIdFromQuery;

  // If no clientId is provided in request, inject the authenticated user's clientId
  if (!providedClientId) {
    req.body.clientId = req.user.clientId;
    return next();
  }

  // If clientId is provided, validate ownership
  if (providedClientId !== req.user.clientId) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'You can only access your own resources'
    });
  }

  next();
};

module.exports = {
  antiAutomationDelay,
  resetLoginAttempts,
  authenticateToken,
  authenticateSuperKey,
  authenticateJWTOrSuperKey,
  validateResourceOwnership,
  validateResourceOwnershipDual,
  checkTokenBalance,
  deductTokens,
  auditLog
};