# Architecture Ideas & Future Improvements

## Hot-Cold Data Architecture Pattern

### Redis-First, MongoDB-Fallback Strategy

**Concept**: Use Redis as the primary working database for active data (0-30 days), then automatically transfer to MongoDB for long-term storage and analytics.

**Architecture Overview**:
```
Redis (Hot Data - 0-30 days):
├── Active campaign status & metrics
├── Real-time call tracking & state
├── Live counters & analytics
├── Session data & temporary states
└── High-frequency atomic operations

MongoDB (Cold Data - 30+ days):
├── Historical campaigns & call logs
├── Analytics & reporting data
├── Audit trails & compliance data
└── Complex queries & aggregations
```

**Implementation Strategy**:

1. **Dual Write Pattern**:
   - Write critical data to both Redis and MongoDB
   - Redis for immediate operations
   - MongoDB as backup and for persistence

2. **TTL-Based Migration**:
   - Set 30-day TTL on Redis keys
   - Background job transfers expiring data to MongoDB
   - Automatic cleanup of old Redis data

3. **Smart Read Strategy**:
   - Check Redis first for recent data
   - Fallback to MongoDB for historical queries
   - Cache frequently accessed historical data back to Redis

**Benefits**:
- **10-100x performance improvement** for active operations
- **Cost optimization** (expensive Redis for hot data, cheaper MongoDB for cold)
- **Automatic data lifecycle management** via TTL
- **Scalability** - Redis handles high-frequency operations, MongoDB handles complex analytics
- **Natural separation** of operational vs analytical workloads

**Implementation Considerations**:
- Data consistency between Redis and MongoDB
- Migration job reliability and monitoring  
- Fallback mechanisms for Redis failures
- Query abstraction layer to handle both systems
- Testing strategy for dual-system architecture

**Ideal for Telephony Systems**:
- Active calls need millisecond response times
- Historical call data needs complex querying
- Clear hot/cold data separation
- High write frequency during campaigns
- Analytics on historical data

**Next Steps**:
1. Design data migration strategy
2. Implement abstraction layer for database operations
3. Create TTL-based archival jobs
4. Add monitoring for both systems
5. Gradual migration of high-frequency operations to Redis

## Global Rate Limiting for Serverless Architecture

### Database-Driven Rate Limiting System

**Problem**: Current `MAX_CALLS_PER_MINUTE` is per-campaign and uses in-memory counters, which doesn't work in serverless where containers can start/stop frequently.

**Current System (Broken in Serverless)**:
```javascript
// Per-campaign, in-memory (won't persist across container restarts)
let callsInLastMinute = 0;
let rateLimitStartTime = Date.now();
```

**Proposed Solution**: Global database-driven rate limiting using MongoDB collection.

**Implementation**:
1. **Create `globalRateLimit` collection**:
   ```javascript
   {
     _id: "global_rate_limit",
     currentMinute: "2024-01-15T10:30:00.000Z", // truncated to minute
     callsInThisMinute: 45,
     lastUpdated: "2024-01-15T10:30:23.456Z"
   }
   ```

2. **Atomic rate limit checking**:
   ```javascript
   // Before each call, atomically increment counter for current minute
   const currentMinute = new Date().setSeconds(0, 0); // truncate to minute
   const result = await rateCollection.findOneAndUpdate(
     { _id: "global_rate_limit", currentMinute },
     { 
       $inc: { callsInThisMinute: 1 },
       $set: { lastUpdated: new Date() }
     },
     { upsert: true, returnDocument: 'after' }
   );
   
   if (result.callsInThisMinute > MAX_CALLS_PER_MINUTE) {
     // Wait for next minute or reject call
   }
   ```

3. **Benefits**:
   - **Global limit**: All campaigns compete for same rate limit
   - **Serverless-friendly**: Persists across container restarts
   - **Atomic operations**: No race conditions between containers
   - **Auto-cleanup**: Old minute records can be cleaned up

4. **Environment Variables**:
   - `MAX_CALLS_PER_MINUTE` - Global system limit (like GLOBAL_MAX_CALLS)
   - `RATE_LIMIT_WINDOW` - Window size in milliseconds (default: 60000)

**Impact**: 
- Replace per-campaign rate limiting with global system limit
- Ensure serverless containers respect shared rate limits
- Better resource management across all campaigns

## Concurrency Race Condition Fix

### Problem: Race Condition in Concurrency Checking

**Current Issue**: Multiple campaigns can exceed concurrency limits due to race condition between concurrency check and call tracking.

**Observed Behavior**: 
- Expected: 10 concurrent calls per client
- Actual: 13-15 concurrent calls (30% overshoot)

**Root Cause**:
```javascript
// Current flow has a 2-3 second gap
1. Check concurrency: "9 calls active, OK to proceed" 
2. Bot warmup (2-3 seconds delay)
3. Make Plivo API call (network latency)
4. FINALLY track the call in database

// During the gap, other campaigns also pass step 1
```

**Solution: Atomic Slot Reservation**
- Reserve concurrency slot IMMEDIATELY during check
- Use `findOneAndUpdate` with upsert for atomic operations
- No race conditions between concurrent containers

**Implementation Challenges**:
- ❌ **Cannot deploy mid-campaign** - Would disrupt active campaigns
- ❌ **Requires campaign restart** - All running campaigns need to stop
- ✅ **Database-driven approach** - Works in serverless environment

**Proposed Atomic Implementation**:
```javascript
// New atomic approach
async function atomicSlotReservation(clientId, callData) {
  // Atomically reserve slot by inserting call record immediately
  const result = await activeCallsCollection.insertOne({
    ...callData,
    status: 'processed', // Reserve slot right away
    clientId: new ObjectId(clientId)
  });
  
  // Then do bot warmup & Plivo call
  // Update record with CallUUID after call succeeds
}
```

**Deployment Strategy**:
1. Wait for all current campaigns to complete
2. Deploy atomic concurrency fix 
3. Start new campaigns with proper concurrency limits

**Benefits**:
- Exact concurrency enforcement (no overshoot)
- Serverless-safe atomic operations
- Better resource management
- Eliminates race conditions

**Note**: This is a **breaking change** that requires coordinated deployment when no campaigns are running.