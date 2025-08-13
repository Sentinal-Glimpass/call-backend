# Security Implementation Plan

This document outlines the comprehensive security strategy for the telephony system to protect against attacks, resource exhaustion, and unauthorized access.

## 🎯 Overview

Our security approach implements **defense in depth** with multiple layers:
1. **CORS Protection** - Strict origin control
2. **IP Rate Limiting** - DDoS and abuse prevention  
3. **JWT+IP Rate Limiting** - Authenticated user protection
4. **Endpoint-Specific Limits** - Business logic protection

## 🌐 1. CORS Configuration

### **Allowed Origins:**
- `glimpass.com` - Main platform
- `markaible.com` - AI service platform
- `localhost` - Development environment
- `staging.glimpass.com` - Staging environment (if applicable)

### **Excluded (Server-to-Server Only):**
- ❌ `plivo.com` - Webhook callbacks (no browser requests)
- ❌ `exotel.com` - Webhook callbacks (no browser requests)  
- ❌ `twilio.com` - Webhook callbacks (no browser requests)

### **Configuration:**
```javascript
const corsOptions = {
  origin: [
    'https://glimpass.com',
    'https://www.glimpass.com',
    'https://markaible.com',
    'https://www.markaible.com',
    'http://localhost:3000',
    'https://staging.glimpass.com'
  ],
  credentials: true,
  optionsSuccessStatus: 200
};
```

## 🛡️ 2. Rate Limiting Strategy

### **Four-Layer Protection:**

#### **Layer 1: IP-Based Rate Limiting (Pre-Authentication)**
- **Purpose**: DDoS protection, anonymous endpoint protection
- **Scope**: All endpoints
- **Limit**: 200 requests/minute per IP
- **Storage**: Redis
- **Key**: `ratelimit:ip:${hashedIP}:${timeWindow}`

#### **Layer 2: Login Endpoint Protection**
- **Purpose**: Brute force attack prevention
- **Scope**: Authentication endpoints
- **Limit**: 3 attempts per 30 seconds per IP
- **Storage**: Redis
- **Key**: `ratelimit:login:${hashedIP}:${timeWindow}`

#### **Layer 3: JWT+IP Combination (Post-Authentication)**
- **Purpose**: Prevent JWT sharing, IP rotation attacks
- **Scope**: All authenticated endpoints
- **Limit**: 1000 requests/hour per JWT+IP combination
- **Storage**: Redis
- **Key**: `ratelimit:${clientId}:${hashedIP}:${timeWindow}`

#### **Layer 4: Business Logic Protection**
- **Purpose**: Resource exhaustion prevention
- **Scope**: Specific high-cost operations
- **Storage**: Database (persistent across restarts)

## 📊 3. Rate Limit Configuration

### **Environment Variables:**
```bash
# Global Rate Limits
GLOBAL_IP_RATE_LIMIT=200              # Requests per minute per IP
GLOBAL_IP_RATE_WINDOW=60000           # 1 minute in milliseconds

# Authentication Rate Limits  
LOGIN_RATE_LIMIT=3                    # Login attempts per window
LOGIN_RATE_WINDOW=30000               # 30 seconds in milliseconds

# Authenticated User Rate Limits
JWT_IP_RATE_LIMIT=1000                # Requests per hour per JWT+IP
JWT_IP_RATE_WINDOW=3600000            # 1 hour in milliseconds

# Campaign Creation Rate Limits
CAMPAIGN_CREATION_RATE_LIMIT=10000    # 10 seconds between campaigns
```

### **Rate Limit Categories:**
```javascript
const RATE_LIMITS = {
  // Global protection
  ip_only: { 
    requests: 200, 
    window: 60000,        // 1 minute
    message: "Too many requests from this IP" 
  },
  
  // Authentication protection
  login: { 
    requests: 3, 
    window: 30000,        // 30 seconds
    message: "Too many login attempts. Please wait 30 seconds." 
  },
  
  // Authenticated user protection
  jwt_ip: { 
    requests: 1000, 
    window: 3600000,      // 1 hour
    message: "Rate limit exceeded. Please slow down." 
  },
  
  // Business logic protection
  campaign_creation: { 
    requests: 1, 
    window: 10000,        // 10 seconds
    message: "Please wait before creating another campaign",
    storage: "database"   // Persistent storage
  }
}
```

## 🏗️ 4. Implementation Architecture

### **Middleware Stack Order:**
```javascript
// 1. CORS Protection (first)
app.use(corsMiddleware);

// 2. IP Rate Limiting (pre-authentication)
app.use(ipRateLimitMiddleware);

// 3. Authentication (JWT validation)
app.use(authMiddleware);

// 4. JWT+IP Rate Limiting (post-authentication)
app.use(jwtIpRateLimitMiddleware);

// 5. Endpoint-Specific Limits (business logic)
router.post('/create-campaign', campaignRateLimitMiddleware, handler);
router.post('/login', loginRateLimitMiddleware, handler);
```

### **Rate Limit Response Format:**
```javascript
// HTTP 429 Too Many Requests
{
  "error": "Rate limit exceeded",
  "message": "Please wait 7 seconds before creating another campaign",
  "retryAfter": 7,
  "rateLimitWindow": 10,
  "rateLimitRemaining": 0
}
```

### **Standard Response Headers:**
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1640995200
X-RateLimit-Window: 3600
Retry-After: 60
```

## 🎯 5. Protected Endpoints

### **High-Priority Protection:**
- `POST /auth/login` - Brute force protection
- `POST /auth/forgot-password` - Abuse prevention
- `POST /plivo/create-campaign` - Resource exhaustion prevention
- `POST /plivo/single-call` - Cost control
- `POST /plivo/upload-csv` - Resource protection

### **Medium-Priority Protection:**
- `GET /plivo/campaign-progress/*` - API abuse prevention
- `POST /plivo/get-report-by-campaign` - Resource protection
- `GET /plivo/get-incoming-by-number` - Database protection

### **Standard Protection:**
- All other authenticated endpoints - General rate limiting

## 🚨 6. Attack Vectors Mitigated

### **✅ Protected Against:**
- **DDoS Attacks**: IP-based rate limiting
- **Brute Force Login**: Login-specific limits
- **JWT Token Sharing**: JWT+IP combination tracking
- **IP Rotation Attacks**: JWT+IP binding
- **Resource Exhaustion**: Campaign creation limits
- **API Abuse**: Global request limits
- **Cross-Origin Attacks**: Strict CORS policy
- **Campaign Spam**: Database-tracked creation limits

### **⚠️ Residual Risks (Mitigated but Possible):**
- **Distributed Attacks**: Multiple IPs + valid JWTs (rate limited)
- **Insider Threats**: Valid users with malicious intent (rate limited)
- **Sophisticated Bots**: Rotating IP/JWT combinations (still rate limited)

## 🔧 7. Configuration Storage

### **Redis-Based (Fast, Scalable):**
- IP rate limiting
- Login rate limiting  
- JWT+IP rate limiting
- Temporary rate limit data

### **Database-Based (Persistent):**
- Campaign creation rate limiting
- Client-specific configurations
- Long-term rate limit tracking

## 📈 8. Monitoring & Alerting

### **Metrics to Track:**
- Rate limit violations per endpoint
- Top IP addresses hitting limits
- Authentication failure rates
- Campaign creation patterns
- Resource utilization during attacks

### **Alert Conditions:**
- Multiple IPs hitting rate limits simultaneously
- High authentication failure rates
- Unusual campaign creation spikes
- JWT+IP combination anomalies

## 🚀 9. Implementation Priority

### **Phase 1 (Critical):**
1. CORS configuration
2. IP-based rate limiting
3. Login endpoint protection

### **Phase 2 (Important):**
4. JWT+IP combination limiting
5. Campaign creation rate limiting

### **Phase 3 (Enhancement):**
6. Advanced monitoring
7. Dynamic rate limit adjustment
8. Tier-based rate limiting

## 🎯 10. Business Benefits

### **Cost Protection:**
- Prevents API abuse → Predictable Plivo costs
- Limits resource usage → Stable server costs
- Reduces attack impact → Lower incident costs

### **User Experience:**
- Fair resource allocation → Consistent performance
- Attack mitigation → Reliable service availability
- Professional API → Industry-standard behavior

### **Security Posture:**
- Multi-layer defense → Comprehensive protection
- Industry standards → Compliance readiness
- Proactive security → Risk reduction

---

## 🔄 Next Steps

1. **Review and approve** this security plan
2. **Implement Phase 1** (CORS + IP limiting)
3. **Test rate limiting** with realistic load
4. **Monitor effectiveness** and adjust limits
5. **Implement remaining phases** based on priority

This security implementation will transform the system into an enterprise-grade, production-ready telephony platform with comprehensive protection against modern attack vectors.