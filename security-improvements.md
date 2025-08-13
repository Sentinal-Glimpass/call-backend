# Security Improvements for /interlogue/get-client

## Current Issues
1. Passwords stored in plain text
2. Full client object returned (potential data leakage)
3. No rate limiting or brute force protection
4. No session/token management
5. No audit logging

## Proposed Solution (Backward Compatible)

### Phase 1: Immediate Security (No API Changes)

#### A. Add Rate Limiting
```javascript
// Add to interlogueRouter.js
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/get-client', loginLimiter, async (req, res) => {
  // existing code
});
```

#### B. Sanitize Response Data
```javascript
// Modified getClient function
async function getClient(email, password) {
  try {
    // ... existing code ...
    const clientData = await collection.findOne({ email, password });
    
    if (clientData) {
      // Remove sensitive fields before returning
      const {
        password: pwd,
        apiKey,
        internalNotes,
        billingDetails,
        ...safeClientData
      } = clientData;
      
      return safeClientData;
    } else {
      return [];
    }
  } catch (error) {
    // ... existing error handling ...
  }
}
```

#### C. Add Audit Logging
```javascript
// Log all login attempts
const loginAttempt = {
  email,
  ip: req.ip,
  userAgent: req.get('User-Agent'),
  timestamp: new Date(),
  success: !!clientData
};

// Store in audit collection
await database.collection("audit_logs").insertOne(loginAttempt);
```

### Phase 2: Enhanced Security (Gradual Migration)

#### A. JWT Token Implementation
```javascript
// Generate JWT on successful login
const jwt = require('jsonwebtoken');

const token = jwt.sign(
  { 
    clientId: clientData._id,
    email: clientData.email 
  },
  process.env.JWT_SECRET,
  { expiresIn: '24h' }
);

return {
  ...safeClientData,
  token, // Add token to response
  expiresIn: '24h'
};
```

#### B. Optional Token Authentication
```javascript
// Add middleware that accepts both methods
const flexibleAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (token) {
    // Validate JWT token
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.clientData = decoded;
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
  
  // Fall back to existing email/password validation
  next();
};
```

### Phase 3: Full Security (Breaking Changes - Plan for Future)

#### A. Password Hashing Migration
```javascript
const bcrypt = require('bcrypt');

// Migration script to hash existing passwords
async function migratePasswords() {
  const clients = await collection.find({}).toArray();
  
  for (const client of clients) {
    if (!client.passwordHash) { // Only migrate unhashed passwords
      const hashedPassword = await bcrypt.hash(client.password, 10);
      await collection.updateOne(
        { _id: client._id },
        { 
          $set: { passwordHash: hashedPassword },
          $unset: { password: 1 } // Remove plain text password
        }
      );
    }
  }
}
```

## Recommended Implementation Order

1. **Week 1**: Rate limiting + Response sanitization + Audit logging
2. **Week 2**: JWT token generation (optional, backward compatible)
3. **Month 2**: Client migration to token-based auth
4. **Month 3**: Password hashing migration with client notification

## Benefits
- ✅ Immediate security improvements
- ✅ Zero downtime deployment
- ✅ Backward compatibility maintained
- ✅ Gradual client migration path
- ✅ Enhanced monitoring capabilities

## Risk Mitigation
- Current clients continue working unchanged
- New security features are additive
- Migration can be rolled back if needed
- Performance impact minimal