# Billing Implementation Plan

## Phase 1: Environment & Database Setup

### 1.1 Environment Variables
```bash
# Add to .env and .env.example
INCOMING_AGGREGATION_TIME=3600000  # 1 hour in milliseconds
# Note: Test calls don't need aggregation timing as they create immediate individual entries
```

### 1.2 Create New Collection & Update Existing
```javascript
// NEW: callBillingDetails collection
{
  _id: ObjectId,
  clientId: String,
  callUuid: String,
  timestamp: Date,
  type: "campaign|incoming|testcall",
  duration: Number, // seconds
  from: String,
  to: String,
  credits: Number, // total credits charged
  aiCredits: Number, // AI processing credits
  telephonyCredits: Number, // call duration credits
  campaignId: String, // null for incoming/testcall
  campaignName: String // null for incoming/testcall
}

// EXISTING: billingHistory collection (no changes to schema)
// EXISTING: client collection - ADD field:
// lastIncomingAggregationTime: Date  // Track last aggregation timestamp per client
```

### 1.3 Database Indexes
```javascript
// callBillingDetails collection indexes
db.callBillingDetails.createIndex({ clientId: 1, timestamp: -1 }) // For cursor pagination
db.callBillingDetails.createIndex({ clientId: 1, type: 1, timestamp: 1 }) // For aggregation queries
db.callBillingDetails.createIndex({ callUuid: 1 }) // For AI credits updates
```

## Phase 2: Core Functions

### 2.1 Call Detail Recording
```javascript
function saveCallBillingDetail(callData)
Input: { clientId, callUuid, duration, type, from, to, campaignId }
Output: { success: boolean, recordId: string }
```

### 2.2 Balance Updates
```javascript
function updateClientBalance(clientId, creditChange)
Input: { clientId: string, creditChange: number }
Output: { success: boolean, newBalance: number }
```

### 2.3 SSE Balance Stream
```javascript
function streamBalance(clientId, response)
Input: { clientId: string, response: ServerResponse }
Output: Continuous SSE stream
```

## Phase 3: API Endpoints  

### 3.1 Real-time Balance
```javascript
// GET /stream/balance/:clientId
function handleBalanceStream(req, res)
Input: clientId from params
Output: SSE stream with balance updates
```

### 3.2 Call Details (Paginated)
```javascript  
// GET /billing/call-details/:clientId
function getCallDetails(req, res)
Input: { clientId, cursor?, limit? }
Output: { calls: [], nextCursor: string, hasMore: boolean }
```

### 3.3 Aggregated Billing
```javascript
// GET /billing/aggregated/:clientId  
function getAggregatedBilling(req, res)
Input: clientId from params
Output: { campaigns: [], batches: [] }
```

## Phase 4: Aggregation Logic

### 4.1 Check Aggregation Need
```javascript
function needsAggregation(clientId)
Input: { clientId: string }
Output: { needed: boolean, lastAggregationTime: Date }
// Check lastIncomingAggregationTime from client table
// Compare with INCOMING_AGGREGATION_TIME env variable
```

### 4.2 Aggregate Calls
```javascript
function aggregateCallsSince(clientId, type, sinceTimestamp)
Input: { clientId, type, sinceTimestamp }
Output: { totalCalls, totalCredits, startTime, endTime }
```

### 4.3 Save Aggregation
```javascript
function saveAggregation(aggregationData)
Input: { clientId, type, title, totals, timeRange }
Output: { success: boolean, aggregationId: string }
// Also update lastIncomingAggregationTime in client table
```

## Phase 5: Integration Points

### 5.1 Hangup Webhook Update
```javascript
// In existing hangup handler
await saveCallBillingDetail(callData);
await updateClientBalance(clientId, -credits);
streamBalanceUpdate(clientId, newBalance);
```

### 5.2 Campaign Completion Hook
```javascript
// When campaign completes
await aggregateCampaignCalls(campaignId);
await saveAggregation(campaignSummary);
```

### 5.3 Test Call Completion Hook
```javascript
// When test call ends (immediate aggregation)
await createTestCallEntry(testCallData);
```

### 5.4 Bot Endpoint Integration
```javascript
// Receive AI credits from bot
function receiveAICredits(callUuid, aiCredits)
Input: { callUuid: string, aiCredits: number }
Output: Update existing call record
```

## Phase 6: Frontend Integration

### 6.1 SSE Client Setup
```javascript
// Connect to balance stream
const eventSource = new EventSource('/stream/balance/clientId');
eventSource.onmessage = updateBalanceDisplay;
```

### 6.2 Pagination Helper
```javascript
// Load call details with cursor
function loadCallDetails(cursor = null, limit = 100)
Input: { cursor?: string, limit: number }
Output: Promise<{ calls, nextCursor, hasMore }>
```

## Implementation Order

1. ✅ Database schemas and indexes
2. ✅ Core billing functions  
3. ✅ Call detail recording in hangup webhook
4. ✅ Balance streaming endpoint
5. ✅ Call details paginated endpoint
6. ✅ Aggregation logic and endpoint
7. ✅ Campaign completion integration
8. ✅ Frontend SSE integration
9. ✅ Bot AI credits integration

## Testing Strategy

- Unit tests for aggregation logic
- Integration tests for SSE streaming
- Load testing for cursor pagination  
- End-to-end billing flow validation