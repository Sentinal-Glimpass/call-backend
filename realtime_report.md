# Real-Time Campaign Reporting System - Design Document

## Current Problem Analysis

### Issues with Current Campaign System:
1. **Black Box Experience**: Once a campaign starts, users have no visibility into progress
2. **No Live Updates**: Users can't see completed calls, success rates, or current status
3. **Guesswork**: No way to estimate completion time or monitor performance
4. **Binary Feedback**: Only "running" or "completed" states, nothing in between

## Proposed Real-Time Reporting Solution

### Core Requirements:
1. **Live Progress Updates**: Real-time completion percentages and call counts
2. **Recent Call Activity**: Show latest completed calls as they happen
3. **Performance Metrics**: Answer rates, call durations, lead quality scores
4. **Campaign Status**: Clear status indicators (queued, running, paused, completed, failed)
5. **ETA Predictions**: Estimated time to completion based on current progress

### Data Sources Available:

#### From `plivoCampaign` Collection:
- Campaign metadata (name, client, start time, total calls)
- Status flags (`isCampaignCompleted`, `isBalanceUpdated`)
- Call counts (`connectedCall`, `failedCall`)

#### From `plivoHangupData` Collection:
- Completed call details (duration, status, end time)
- Call quality metrics (hangup cause, call status)
- Recent call activity (sorted by end time)

#### From `activeCalls` Helper:
- Current active call count
- Real-time concurrency information

## Design Options

### Option 1: Polling-Based Real-Time Updates
**Endpoint**: `POST /plivo/current-campaign-report`
**Frequency**: Frontend polls every 5-10 seconds
**Pros**: Simple implementation, works with current architecture
**Cons**: Higher server load, not truly real-time

### Option 2: WebSocket-Based Live Updates  
**Implementation**: WebSocket connection per campaign
**Updates**: Push updates on call completion events
**Pros**: True real-time updates, lower server load
**Cons**: More complex, requires WebSocket infrastructure

### Option 3: Hybrid Approach
**Combination**: Polling for initial data + WebSocket for live updates
**Best of both**: Reliability of polling + real-time benefits
**Implementation**: Progressive enhancement

## Recommended Data Structure

```json
{
  "campaignId": "string",
  "campaignName": "string",
  "status": "queued|running|paused|completed|failed",
  
  "progress": {
    "totalCalls": 100,
    "completedCalls": 45,
    "failedCalls": 5,
    "remainingCalls": 50,
    "completionPercentage": 45.0,
    "estimatedTimeRemaining": "15 minutes"
  },
  
  "callMetrics": {
    "averageDuration": 120,
    "totalDuration": 5400,
    "answerRate": 85.5,
    "leadConversionRate": 23.2,
    "activeCalls": 3
  },
  
  "recentActivity": [
    {
      "callUUID": "uuid",
      "number": "+919876543210",
      "status": "completed",
      "duration": 130,
      "endTime": "2025-08-07T15:30:00Z",
      "leadStatus": "hot|warm|cold|no-answer",
      "hangupCause": "NORMAL_CLEARING"
    }
  ],
  
  "timeline": {
    "startTime": "2025-08-07T14:00:00Z",
    "lastUpdateTime": "2025-08-07T15:30:00Z",
    "estimatedEndTime": "2025-08-07T16:15:00Z"
  }
}
```

## Implementation Approaches

### Phase 1: Basic Real-Time Reporting
- Create polling endpoint
- Calculate real-time metrics
- Show campaign progress and recent calls
- Implement basic status detection

### Phase 2: Enhanced Analytics  
- Add lead scoring and conversion tracking
- Implement ETA calculations
- Add performance benchmarking
- Create trend analysis

### Phase 3: Advanced Features
- WebSocket integration for live updates
- Campaign pause/resume controls
- Real-time campaign optimization suggestions
- Multi-campaign dashboard

## Technical Considerations

### Database Performance:
- Index `campId` field in `plivoHangupData` for fast queries
- Consider caching frequently accessed campaign data
- Optimize aggregation queries for large campaigns

### Scalability:
- Design for multiple concurrent campaigns
- Consider database connection pooling
- Plan for high-frequency polling load

### Error Handling:
- Handle campaign not found scenarios
- Graceful degradation when data is incomplete
- Proper ownership validation

## Questions for Discussion:

1. **Update Frequency**: How often should the frontend poll for updates? (5s, 10s, 30s?)
2. **Data Retention**: How many recent calls should we show? (10, 25, 50?)
3. **Performance Priority**: Should we prioritize accuracy or speed for large campaigns?
4. **Future Features**: Do we want campaign control features (pause/resume) in this phase?
5. **WebSocket Timeline**: When should we consider implementing WebSocket updates?

## Next Steps:

1. Finalize the API specification and response format
2. Determine optimal polling frequency and data limits
3. Plan database indexing strategy for performance
4. Design error handling and edge case scenarios
5. Create implementation timeline and milestones