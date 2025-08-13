# Frontend JWT Integration Guide

## Overview
The backend now uses JWT tokens for secure authentication. All ACTIVE API endpoints require proper authentication.

## Authentication Flow

### 1. Login Process
- **Endpoint**: `POST /interlogue/get-client` 
- **No JWT Required**: This is a public endpoint for login
- **Request**: 
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```
- **Response**:
```json
{
  "success": true,
  "user": {
    "id": "user_id",
    "email": "user@example.com", 
    "name": "User Name",
    "company": "Company Name",
    "tokens": 100,
    "isActive": true,
    "apiKey": "legacy_api_key"
  },
  "token": "jwt_token_here",
  "expiresIn": "24h",
  "message": "Login successful"
}
```

### 2. Storing and Using JWT Token
Store the JWT token from login response and include it in all subsequent API calls:

```javascript
// Store token after login
localStorage.setItem('jwt_token', response.token);

// Use token in API calls
const token = localStorage.getItem('jwt_token');
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

### 3. API Request Format
All protected endpoints now require the JWT token in the Authorization header:

```javascript
// Example API call
fetch('/interlogue/get-assistant-details', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt_token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    assistantId: 'assistant_id'
    // clientId is automatically injected by middleware
  })
})
```

## Key Changes for Frontend

### 1. Remove Manual clientId Injection
- **Before**: Frontend manually added `clientId` to request body
- **Now**: Backend automatically injects `clientId` from JWT token
- **Action**: Remove `clientId` from request bodies where it was manually added

### 2. Handle Authentication Errors
Implement proper error handling for authentication failures:

```javascript
// Handle 401 (Unauthorized) responses
if (response.status === 401) {
  // Token expired or invalid
  localStorage.removeItem('jwt_token');
  window.location.href = '/login';
}

// Handle 402 (Insufficient Tokens) responses  
if (response.status === 402) {
  // Show token balance warning
  alert('Insufficient tokens for this operation');
}

// Handle 403 (Forbidden) responses
if (response.status === 403) {
  // Access denied or account suspended
  alert('Access denied. Please contact support.');
}
```

### 3. Token Balance Monitoring
Monitor user's token balance and show warnings:

```javascript
// Display current token balance (from login response or user object)
const tokenBalance = user.tokens;
if (tokenBalance < 10) {
  showLowTokenWarning();
}
```

### 4. Rate Limiting Handling
Handle rate limiting responses:

```javascript
// Handle 429 (Too Many Requests) responses
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  showRateLimitWarning(retryAfter);
}
```

## Protected Endpoints

### Interlogue Routes
- `POST /interlogue/update-client` (Auth + Resource validation)
- `POST /interlogue/get-client-by-clientId` (Auth + Resource validation) 
- `POST /interlogue/get-assistant` (Auth + Resource validation)
- `POST /interlogue/get-assistant-details` (Auth + 2 tokens)
- `POST /interlogue/create-assistant` (Auth + 5 tokens)
- `POST /interlogue/update-assistant` (Auth + 3 tokens)

### Exotel Routes  
- `POST /exotel/schedule-call` (Auth + 5 tokens)
- `POST /exotel/campaign-call` (Auth + 10 tokens)
- `POST /exotel/create-campaign` (Auth + 3 tokens)
- `POST /exotel/get-camp-by-clientId` (Auth + Resource validation)
- `POST /exotel/create-list` (Auth + 2 tokens)
- And many more...

### Plivo Routes
- `POST /plivo/get-list-by-clientId` (Auth + Resource validation)
- `POST /plivo/single-call` (Auth + 3 tokens)
- `POST /plivo/create-campaign` (Auth + 5 tokens)
- And more...

### IP Routes
- `GET /ip/next_ip` (Auth + 1 token)
- `GET /ip/release-session` (Auth only)

## Token Costs
Different operations have different token costs:
- Basic queries: 1-2 tokens
- Assistant operations: 2-5 tokens  
- Campaign operations: 3-10 tokens
- Call operations: 3-5 tokens

## Migration Steps

1. **Update Login Flow**: Modify login to store JWT token instead of just user data
2. **Add Authorization Headers**: Update all API calls to include Bearer token
3. **Remove Manual clientId**: Remove clientId from request bodies where manually added
4. **Add Error Handling**: Implement proper error handling for auth failures
5. **Update State Management**: Store and manage JWT token in state/localStorage
6. **Test All Features**: Test all functionality with new auth system

## Backward Compatibility

- Legacy API key system still works for `/api.markaible` routes
- Login endpoint remains public (no JWT required)
- User gets both JWT token and legacy apiKey in login response for transition period

## Security Benefits

1. **Token-based usage tracking**: Every API call is tracked and costs tokens
2. **Rate limiting**: Built-in protection against abuse
3. **Resource ownership**: Users can only access their own data
4. **Audit logging**: All actions are logged for security monitoring
5. **Token expiration**: Tokens expire after 24 hours for security