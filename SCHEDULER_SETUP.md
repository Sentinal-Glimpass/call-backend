# Cloud Scheduler Setup for Scheduled Campaigns

## Overview
This document describes the Cloud Scheduler setup for automatically checking and starting scheduled campaigns every 10 minutes.

## Setup Completed ✅

### 1. Endpoint Created
- **Path**: `/plivo/check-scheduled-campaigns`
- **Method**: GET
- **Location**: `src/routes/plivoRouter.js` (line 3407)
- **Authentication**: None (public endpoint)
- **Function**: Queries MongoDB for campaigns with `status: "scheduled"` and `scheduledTime <= now()`, then starts them

### 2. Environment Variable Added
- **Variable**: `MAX_CAMPAIGNS=5`
- **Location**: `.env` file (line 99)
- **Purpose**: Limits how many scheduled campaigns can be started in parallel during each check

### 3. Cloud Scheduler Job Created
- **Job Name**: `check-scheduled-campaigns`
- **Project**: `halogen-segment-424319-n1`
- **Location**: `us-central1`
- **Schedule**: `* * * * *` (every 1 minute)
- **Target**: `http://34.46.160.203:7999/plivo/check-scheduled-campaigns`
- **Method**: GET
- **Timeout**: 300 seconds
- **Time Zone**: UTC
- **State**: ENABLED ✅

### 4. Testing Results
✅ **Manual curl test**: Endpoint returned `200 OK` with correct JSON response
✅ **Cloud Scheduler manual run**: Successfully triggered endpoint from IP `35.187.132.132` (Google Cloud)
✅ **Server logs**: Confirmed scheduler check executed with `MAX_CAMPAIGNS limit: 5`

## How It Works

### Every 1 Minute:
1. Cloud Scheduler makes GET request to `/plivo/check-scheduled-campaigns`
2. Endpoint queries MongoDB:
   ```javascript
   status: "scheduled"
   scheduledTime: { $lte: now }
   ```
3. Sorts by `scheduledTime` ASC (oldest first)
4. Limits results to `MAX_CAMPAIGNS` (default: 5)
5. For each campaign:
   - Updates status to `"running"`
   - Calls `makeCallViaCampaign()` to start it
   - Returns success/failure in response

### Response Format:
```json
{
  "success": true,
  "message": "Started 3 scheduled campaign(s)",
  "started": [
    {
      "campaignId": "...",
      "campaignName": "...",
      "scheduledTime": "2025-10-01T15:00:00.000Z",
      "actualStartTime": "2025-10-01T15:02:31.324Z"
    }
  ],
  "skipped": 0,
  "errors": [],
  "timestamp": "2025-10-01T15:02:31.324Z",
  "maxCampaigns": 5
}
```

## Management Commands

### View Scheduler Job
```bash
gcloud scheduler jobs describe check-scheduled-campaigns --location=us-central1
```

### List All Scheduler Jobs
```bash
gcloud scheduler jobs list --location=us-central1
```

### Manually Trigger (for testing)
```bash
gcloud scheduler jobs run check-scheduled-campaigns --location=us-central1
```

### Pause Scheduler
```bash
gcloud scheduler jobs pause check-scheduled-campaigns --location=us-central1
```

### Resume Scheduler
```bash
gcloud scheduler jobs resume check-scheduled-campaigns --location=us-central1
```

### Update Schedule (change frequency)
```bash
gcloud scheduler jobs update http check-scheduled-campaigns \
  --location=us-central1 \
  --schedule="*/5 * * * *"  # Example: every 5 minutes
```

### Delete Scheduler Job
```bash
gcloud scheduler jobs delete check-scheduled-campaigns --location=us-central1
```

## Next Steps (Pending Implementation)

1. **Add scheduled fields to campaign creation**:
   - Modify `createCampaign()` in `src/apps/plivo/plivo.js`
   - Add `scheduledTime` and `scheduledBy` fields
   - Set `status: "scheduled"` if `scheduledTime` is provided

2. **Update `/create-campaign` endpoint**:
   - Accept optional `scheduledTime` parameter
   - Don't call `process.nextTick()` if campaign is scheduled
   - Return immediately with "Campaign scheduled" message

3. **Update CRUD operations**:
   - `/pause-campaign`: Already handles all statuses ✅
   - `/resume-campaign`: Already handles all statuses ✅
   - `/cancel-campaign`: Already handles all statuses ✅
   - Add reschedule functionality (update `scheduledTime`)

## Environment Configuration

**Required .env variables:**
- `MAX_CAMPAIGNS`: Maximum parallel campaign starts (default: 5)
- `BASE_URL`: Base URL for webhooks (already configured)

## Monitoring

View scheduler logs:
```bash
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=check-scheduled-campaigns" --limit=50 --format=json
```

View endpoint access logs on server:
```bash
# Look for: "⏰ Scheduled campaign check triggered at:"
# And: "📋 Found X scheduled campaigns ready to start"
```

## Notes

- Scheduler runs in UTC timezone
- **1-minute granularity** means campaigns scheduled for specific times will start within 0-1 minutes of their scheduled time
- The scheduler will retry failed requests automatically (Google Cloud default retry policy)
- Endpoint is idempotent - safe to call multiple times
- Current setting: Every 1 minute (can be adjusted via gcloud command)

## Cost Considerations

- **Cloud Scheduler**: Free tier includes 3 jobs
- **Additional jobs**: $0.10 per job per month
- **This setup**: 1 job = FREE ✅

---

**Setup Date**: 2025-10-01
**Tested By**: Claude Code
**Status**: ✅ WORKING
