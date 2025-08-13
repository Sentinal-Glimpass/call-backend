# Billing System Logic

## Overview
3-tier billing system: Real-time balance, detailed call data, and smart aggregated view.

## Data Flow

### 1. Call Ends
- Hangup webhook receives call data
- Save detailed call info to `callBillingDetails` collection
- Update client balance immediately in `client` collection
- Stream balance update via SSE to connected clients

### 2. Real-time Balance (Endpoint 1)
**GET** `/stream/balance/:clientId`
- Server-Sent Events connection
- Push balance updates when calls end
- Auto-reconnects, minimal overhead

### 3. Call-Level Details (Endpoint 2)
**GET** `/billing/call-details/:clientId?cursor=abc&limit=100`
- Cursor-based pagination (100 records per request)
- Returns individual call records with credits breakdown
- Used for detailed analysis/auditing

### 4. Aggregated View (Endpoint 3)
**GET** `/billing/aggregated/:clientId`
- Shows campaign-level entries (pre-aggregated when campaign completes)
- Shows individual test call entries (immediate aggregation)
- Smart aggregation for incoming calls only:
  - Check `lastIncomingAggregationTime` in client table
  - Only aggregate if time passed >= `INCOMING_AGGREGATION_TIME` AND endpoint is hit
  - Process only NEW incoming calls since last aggregation timestamp
  - Update `lastIncomingAggregationTime` in client table after aggregation
- Returns clean billing statements clients see

## Aggregation Rules

### Campaign Calls
- **When**: Campaign completion
- **Entry**: 1 entry per campaign with total stats

### Test Calls
- **When**: Immediately after each test call
- **Entry**: Individual test call entry (like campaigns)

### Incoming Calls  
- **When**: Only when BOTH conditions met:
  1. Aggregated API endpoint is hit  
  2. Time since last aggregation >= `INCOMING_AGGREGATION_TIME` (1 hour from env variable)
- **Entry**: "Incoming Calls (date range)" with batch totals

## Data Storage

### Collections
1. **callBillingDetails** - Every call with full breakdown (NEW)
2. **billingHistory** - User-facing aggregated entries (EXISTING)  
3. **client** - Real-time balance updates + lastIncomingAggregationTime tracking (EXISTING)

### Credits Display
- Show only credits (no dollars)
- Breakdown: Total = AI Credits + Telephony Credits