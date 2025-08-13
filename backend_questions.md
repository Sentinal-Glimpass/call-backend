# Backend Questions for JWT Integration

## Questions from Frontend Developer

### 1. Login Response Format
According to FRONTEND_JWT_INTEGRATION.md, the login response should include:
```json
{
  "success": true,
  "user": { ... },
  "token": "jwt_token_here",
  "expiresIn": "24h",
  "message": "Login successful"
}
```

**Question**: Does the current `/interlogue/get-client` endpoint already return this new format, or does it still return the old format? The current frontend expects the response to be directly in `response.data` array format.

### 2. ClientId Injection
The documentation states that `clientId` is automatically injected from JWT token by middleware.

**Question**: Which specific endpoints have this automatic clientId injection implemented? Should we remove `clientId` from ALL API calls or only specific ones?

### 3. Token Costs
The document mentions different token costs for operations, but the frontend needs to:
- Show current token balance to users
- Predict token costs before operations
- Handle insufficient token scenarios

**Questions**: 
- Is there an endpoint to get current token balance?
- Is there an endpoint to preview operation costs before executing?
- Should we implement client-side token cost calculation?

### 4. Error Response Format
**Question**: What is the exact format of error responses for 401, 402, 403, 429 errors? Do they include specific error messages or codes we should handle?

### 5. Rate Limiting Headers
**Question**: What specific headers does the backend send with 429 responses? Is it just `Retry-After` or are there other headers like `X-RateLimit-Remaining`?

### 6. Backward Compatibility
**Question**: How long will the legacy API key system remain active? Should we implement a migration path or dual auth system?

### 7. Token Refresh
**Question**: Is there a token refresh endpoint? How should the frontend handle token expiration (24h) - automatic refresh or force re-login?

### 8. CSRF Protection
**Question**: Are there any CSRF tokens or additional security headers required beyond the JWT Bearer token?

### 9. Provider-specific Authentication
The frontend uses different providers (Plivo/Exotel). 
**Question**: Do all provider endpoints use the same JWT authentication, or are there provider-specific auth requirements?

### 10. File Upload Authentication
**Question**: How does JWT authentication work with multipart/form-data requests (CSV uploads)? Should the token be in headers or form data?

### 11. CSV Upload Endpoint Status
**URGENT**: The `/upload-csv` endpoint is returning "API key missing" error (401) even with JWT Bearer token in Authorization header. 

**Questions**:
- Has the `/upload-csv` endpoint been updated to use JWT middleware?
- Are there provider-specific upload endpoints that need JWT updates?
- Should we temporarily add API key fallback for upload endpoints?

**Error Details**:
```
POST /upload-csv → 401 (3ms)
Response: {"error":"API key missing"}
Auth: ✅ Bearer token present
```

## Implementation Priority
Please prioritize answers for questions 1, 2, 4, and **11** as these are blocking the implementation.