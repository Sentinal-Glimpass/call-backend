# Call Monitoring Logic - Implementation Plan

## 🎯 Main Idea
Convert campaign monitoring from "contact-based" to "call-lifecycle-based" tracking using existing webhooks to maintain accurate call states in `activeCalls` collection.

## 📊 Current Problem
- Campaign shows `status: "completed"` when calls are still active
- Only tracks contact processing, not actual call completion
- Missing real-time call state visibility

## 🔄 Solution: 4-State Call Lifecycle Tracking

### Call States in `activeCalls` Collection:
1. **`processed`** - Plivo API called, CallUUID received
2. **`ringing`** - Ring webhook received  
3. **`call-ended`** - Hangup webhook received
4. **`completed`** - Bot analytics data merged

### Campaign States:
- **`pending`** - Created but not started
- **`running`** - Actively processing contacts
- **`paused`** - Manually paused
- **`cancelled`** - Manually stopped
- **`completed`** - All calls finished
- **`failed`** - System error

## 📤 Minimal API Response (8 keys):
```javascript
{
  "success": true,
  "campaignId": "689b204e741aea78a64324b5",
  "campaignName": "qwqwq", 
  "totalContacts": 2,
  "callCounts": {
    "processed": 2,    // API calls made
    "ringing": 1,      // Ring webhooks received
    "call-ended": 1,   // Hangup webhooks received  
    "completed": 0     // Bot data merged
  },
  "campaignStatus": "running"  // pending | running | paused | cancelled | completed | failed
}
```

## 🔧 Code Changes Required

### 1. Update `activeCalls` Schema
**File**: `src/apps/helper/activeCalls.js`
**Function**: `trackCallStart()`
**Change**: Add `callStatus` field when creating records
```javascript
// EXISTING:
const callRecord = {
  callUUID: callData.callUUID,
  status: 'active'  // Remove this field
  // ...other fields
};

// NEW:
const callRecord = {
  callUUID: callData.callUUID, 
  callStatus: 'processed',  // Add this field
  // ...other fields
};
```

### 2. Update Ring Webhook
**File**: `src/routes/plivoRouter.js`  
**Function**: `POST /ring-url` (line 1234)
**Change**: Update `callStatus` instead of just `ringTime`
```javascript
// EXISTING:
const result = await activeCallsCollection.updateOne(
  { callUUID: CallUUID },
  { $set: { ringTime: new Date() } }
);

// NEW:
const result = await activeCallsCollection.updateOne(
  { callUUID: CallUUID },
  { $set: { 
    callStatus: 'ringing',
    ringTime: new Date() 
  } }
);
```

### 3. Update Hangup Webhook  
**File**: `src/routes/plivoRouter.js`
**Function**: `POST /hangup-url` (line 1278)
**Change**: Add status update (currently missing!)
```javascript
// ADD THIS after line ~1320 (after billing logic):
await activeCallsCollection.updateOne(
  { callUUID: CallUUID },
  { $set: { 
    callStatus: 'call-ended',
    endTime: new Date(),
    duration: CallDuration,
    hangupCause: HangupCause
  } }
);
```

### 4. Update Bot Data Webhook
**File**: `src/routes/exotelRouter.js`
**Function**: `POST /save-log-data` (line 715)  
**Change**: Add status update after saving log data
```javascript
// ADD THIS after saveLogData() call:
const { callUUID } = req.body;
if (callUUID) {
  await activeCallsCollection.updateOne(
    { callUUID: callUUID },
    { $set: { callStatus: 'completed' } }
  );
}
```

### 5. Rewrite Campaign Progress Function
**File**: `src/apps/plivo/plivo.js`
**Function**: `getCampaignProgress()` (line 1635)
**Change**: Replace entire function logic
```javascript
async function getCampaignProgress(campaignId) {
  await connectToMongo();
  const database = client.db("talkGlimpass");
  
  // Get campaign basic info
  const campaign = await database.collection("plivoCampaign")
    .findOne({ _id: new ObjectId(campaignId) });
  
  if (!campaign) {
    return { success: false, error: "Campaign not found" };
  }
  
  // Count call states
  const activeCallsCollection = database.collection("activeCalls");
  const callCounts = await activeCallsCollection.aggregate([
    { $match: { campaignId: new ObjectId(campaignId) } },
    { $group: { 
      _id: "$callStatus", 
      count: { $sum: 1 } 
    } }
  ]).toArray();
  
  // Convert to required format
  const counts = { processed: 0, ringing: 0, "call-ended": 0, completed: 0 };
  callCounts.forEach(item => {
    if (counts.hasOwnProperty(item._id)) {
      counts[item._id] = item.count;
    }
  });
  
  // Determine campaign status
  let campaignStatus = campaign.status;
  if (!['paused', 'cancelled', 'failed', 'completed'].includes(campaignStatus)) {
    const hasActiveCalls = counts.processed + counts.ringing > counts["call-ended"] + counts.completed;
    campaignStatus = hasActiveCalls ? 'running' : 'completed';
  }
  
  return {
    success: true,
    campaignId: campaignId,  
    campaignName: campaign.campaignName,
    totalContacts: campaign.totalContacts,
    callCounts: counts,
    campaignStatus: campaignStatus
  };
}
```

## 📈 Benefits
- **Accurate Status**: No more "completed" when calls are active
- **Real-time**: Live call state tracking via webhooks
- **Minimal Data**: Only 8 keys returned, everything else derivable
- **Robust Logic**: Uses actual call lifecycle, not just contact processing
- **Minimal Code**: ~30 lines changed across 4 files

## 🎯 Implementation Priority
1. Fix hangup webhook (critical - currently missing)
2. Update campaign progress function 
3. Add status updates to other webhooks
4. Update call creation to use new schema

**Total LOC Impact: ~30 lines changed, 0 new files, maximum monitoring accuracy**