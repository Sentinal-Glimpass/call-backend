# Billing System Architecture & Logic

## Database Tables

### 1. `billingHistory` - Aggregate Billing Entries
**Purpose**: Single entry per billing event for user-facing billing records

**Entries**:
- ✅ **1 entry per completed campaign** (regardless of call count)
- ✅ **1 entry per test call** (immediate after call ends)
- ✅ **1 entry per incoming call** (immediate after call ends) 
- ✅ **1 entry per recharge event** (credit top-ups)

**Schema**:
```javascript
{
  clientId: String,
  camp_name: String, // Campaign name, "Test Call", "Incoming Call", "Credit Recharge"
  campaignId: String, // Campaign ID or empty for test/incoming
  balanceCount: Number, // Negative for deductions, positive for recharges
  date: Date,
  desc: String, // Human readable description
  transactionType: String, // 'Dr' (debit) or 'Cr' (credit)
  newAvailableBalance: Number, // Balance after this transaction
  callUUID: String, // Only for test/incoming calls
  callDuration: Number,
  callType: String, // 'campaign_aggregate', 'testcall', 'incoming', 'recharge'
  from: String, // Only for individual calls
  to: String // Only for individual calls
}
```

### 2. `callBillingDetails` - Individual Call Records
**Purpose**: Detailed tracking of every single call for analytics/debugging

**Entries**:
- ✅ **Every campaign call** (with credits: 0 until campaign completes)
- ✅ **Every test call** (with actual credits)
- ✅ **Every incoming call** (with actual credits)

**Schema**:
```javascript
{
  clientId: String,
  callUuid: String,
  timestamp: Date,
  type: String, // 'campaign', 'testcall', 'incoming'
  duration: Number,
  from: String,
  to: String,
  credits: Number, // 0 for campaign calls until aggregated
  aiCredits: Number,
  telephonyCredits: Number,
  campaignId: String,
  campaignName: String
}
```

## Billing Behavior by Call Type

### 🔴 Campaign Calls (During Execution)
**Hangup Webhook Behavior**:
```
❌ NO billingHistory entry
✅ callBillingDetails entry (credits: 0)
❌ NO balance update
❌ NO SSE broadcast
```

### 🟢 Campaign Completion
**When Campaign Ends (completed/cancelled/failed)**:
```
✅ ONE billingHistory entry (total campaign cost)
✅ Update all callBillingDetails entries with actual credits
✅ Balance update (deduct total cost)
✅ SSE broadcast
✅ Mark campaign as billed (isBalanceUpdated: true)
```

### 🔵 Test Calls
**Hangup Webhook Behavior**:
```
✅ billingHistory entry (immediate)
✅ callBillingDetails entry (with actual credits)
✅ Balance update (immediate deduction)
✅ SSE broadcast
```

### 🟡 Incoming Calls
**Hangup Webhook Behavior**:
```
✅ billingHistory entry (immediate)
✅ callBillingDetails entry (with actual credits)
✅ Balance update (immediate deduction)
✅ SSE broadcast
```

## Balance Check Logic

### Balance Validation Rules
```javascript
// For ALL operations (campaigns, test calls)
if (clientBalance <= 0) {
  return ERROR_INSUFFICIENT_BALANCE; // Block operation
}
```

### During Campaign Execution
```javascript
// Before EACH campaign call
const balance = await getCurrentClientBalance(clientId);
if (balance <= 0) {
  // Pause campaign
  await pauseCampaign(campaignId);
  await updateCampaignPauseReason(campaignId, 'insufficient_balance', balance);
  break; // Stop processing more calls
}
```

### API Endpoint Responses
- **Create Campaign**: `400 - Insufficient balance` if balance <= 0
- **Single Call**: `400 - Insufficient balance` if balance <= 0
- **Play Campaign**: `400 - Insufficient balance` if balance <= 0

## Implementation Requirements

### 1. Hangup Handler (`/hangup-url`)
```javascript
if (callType === 'campaign') {
  // ONLY track, NO billing
  await saveCallBillingDetail({
    credits: 0, // Will be updated when campaign completes
    // ... other details
  });
  // NO billingHistory entry
  // NO balance update
} else if (callType === 'testcall' || callType === 'incoming') {
  // IMMEDIATE billing
  await saveCallBillingDetail({ credits: actualCredits });
  await createBillingHistoryEntry({ balanceCount: -actualCredits });
  await updateClientBalance(clientId, -actualCredits);
  await broadcastBalanceUpdate();
}
```

### 2. Campaign Completion Handler
```javascript
// Triggered ONLY by getReportByCampId() when campaign status is 'completed'/'cancelled'/'failed'
// getCampaignProgress() does NOT trigger billing (prevents duplicates)

const totalDuration = await calculateCampaignTotalDuration(campaignId);
const totalCost = totalDuration; // 1 second = 1 credit

// Create single billingHistory entry
await createBillingHistoryEntry({
  camp_name: campaignName,
  campaignId: campaignId,
  balanceCount: -totalCost,
  callType: 'campaign_aggregate',
  desc: `Campaign completion: ${campaignName} - ${callCount} calls, ${totalDuration} seconds total`
});

// Update client balance
await updateClientBalance(clientId, -totalCost);

// Update all callBillingDetails entries for this campaign
await updateCampaignCallCredits(campaignId, totalCost);

// Mark as billed
await updateCampaignBalanceStatus(campaignId, true);
```

### 3. Balance Check Points
```javascript
// Before campaign creation
const validation = await validateClientBalance(clientId);
if (!validation.canStart) {
  return 400; // Insufficient balance
}

// Before each campaign call
const balance = await getCurrentClientBalance(clientId);
if (balance <= 0) {
  await pauseCampaign(campaignId);
  break;
}

// Before test call
const validation = await validateClientBalance(clientId);
if (!validation.canStart) {
  return 400; // Insufficient balance
}
```

## Current Issues in Code

### ❌ Problems to Fix:
1. **Hangup handler bills campaign calls immediately** (should only track)
2. **Campaign completion billing may not trigger reliably**
3. **Balance validation inconsistent across endpoints**
4. **Campaign pause logic not properly integrated**
5. **Variable name conflicts in balance validation functions**

### ✅ What Works:
1. Database schema structure is correct
2. Basic balance validation functions exist
3. Campaign completion detection logic exists
4. SSE broadcasting system exists

## Next Steps

1. **Fix hangup handler** - Remove billing for campaign calls
2. **Ensure reliable campaign completion billing** - Add to all campaign status check points
3. **Standardize balance validation** - Use consistent logic across all endpoints
4. **Test campaign pause behavior** - Ensure balance checks pause campaigns correctly
5. **Add comprehensive logging** - Track billing events for debugging

## Testing Scenarios

### Scenario 1: Campaign with Sufficient Balance
- Create campaign (10 contacts, 300 credits needed, 500 available) ✅
- Campaign runs, no billingHistory entries during execution ✅
- Campaign completes, ONE billingHistory entry created ✅
- Balance updated: 500 → 200 ✅

### Scenario 2: Campaign with Insufficient Balance
- Create campaign (100 contacts, 3000 credits needed, 50 available) ✅
- Campaign starts (has positive balance) ✅
- After ~2 calls, balance goes to 0 ✅
- Campaign pauses automatically ✅
- Balance stays at 0, no billing until campaign ends ✅

### Scenario 3: Test Call
- Make test call (30 seconds, 50 credits available) ✅
- Call completes ✅
- Immediate billingHistory entry created ✅
- Balance updated: 50 → 20 ✅

### Scenario 4: Zero Balance
- Try to create campaign with 0 balance ❌ Block with 400
- Try to make test call with 0 balance ❌ Block with 400