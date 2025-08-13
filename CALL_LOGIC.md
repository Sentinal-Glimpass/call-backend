# Main Call Logic Documentation

## Architecture Overview

**Core Principle**: Campaign = Multiple Single Calls. All call logic resides in single call processing.

**Serverless Design**: Built for Google Cloud Run with automatic orphaned campaign recovery and heartbeat-based container coordination.

## Call Flow Diagram

### **Single Call Flow:**
```
📞 Single Call Request
    ↓
🔍 Check Client + Global Concurrency Limits
    ↓
⏳ Wait if limits reached (MAX_CONCURRENT_CALL_WAIT)
    ↓
🤖 Bot Warmup (GET request with 60s timeout, 3 retries)
    ↓
🚀 Make Plivo API Call
    ↓
📋 Insert CallUUID to activeCalls tracking table
    ↓
⏱️ Wait between calls (SUBSEQUENT_CALL_WAIT)
    ↓
📞 Ready for next call
```

### **Campaign Flow with Pause/Resume & Heartbeat:**
```
📊 Campaign Request
    ↓
📋 Create Campaign Record (status: "running", currentIndex: 0, heartbeat: now)
    ↓
🤖 Start Heartbeat Timer (updates heartbeat every 30 seconds)
    ↓
🔄 LOOP: For each contact starting from currentIndex:
    ↓
🛡️ Check Campaign Status in Database
    ↓
📊 IF status = "paused" → ⏸️ BREAK (Stop Processing & Heartbeat)
    ↓
📊 IF status = "cancelled" → 🛑 BREAK (Stop Processing & Heartbeat)  
    ↓
📊 IF status = "running" → ✅ Continue
    ↓
📝 Update currentIndex = current position
    ↓
📞 Call Single Call Logic (same as above)
    ↓
📈 Update processedContacts++, lastActivity timestamp, and campaign stats
    ↓
🔄 Next Contact
    ↓
🏁 All Contacts Done → Update status = "completed" → Stop Heartbeat

Pause/Resume Flow:
⏸️ PAUSE API → Update status = "paused" → Loop stops, heartbeat stops
▶️ RESUME API → Update status = "running" → Start new loop + heartbeat from saved currentIndex

Orphaned Campaign Recovery (Cloud Run):
🚀 Container Startup → Find campaigns with stale heartbeats → Auto-resume orphaned campaigns
💀 Container Dies → Heartbeat stops → Next container detects and recovers
```

## Detailed Step-by-Step Process

### **Campaign Processing Logic:**

#### **Campaign Initialization:**
Campaign creation establishes the database record with initial state including status set to "running", currentIndex at 0, and calculates totalContacts from the contact list. The heartbeat timestamp is initialized to track container health.

#### **Campaign Processing Loop with Heartbeat:**
Campaign processing begins by starting a background heartbeat timer that updates the heartbeat field every 30 seconds to indicate the container is alive and actively processing.

The main processing loop iterates through contacts starting from the saved currentIndex. Before each call, the system checks the campaign status in the database - if paused or cancelled, the loop breaks gracefully and stops the heartbeat timer.

For each active contact, the system updates the currentIndex to track progress, then calls the single call processing logic. After each call attempt (successful or failed), the system updates both the lastActivity timestamp and campaign statistics.

When all contacts are processed, the campaign status is marked as "completed" and the heartbeat timer is stopped.

### **Single Call Processing Logic:**

#### **Step 1: Concurrency Check**
The system queries the database to check both client-specific and global concurrent call limits. Client limits are stored in the client collection (defaulting to 10), while global limits are set via environment variables (defaulting to 50).

#### **Step 2: Wait for Available Slot**
If either limit is exceeded, the system enters a waiting loop, checking limits every few seconds (configurable wait time) until slots become available. This ensures fair resource distribution across all clients.

#### **Step 3: Bot Warmup**
Before making the actual call, the system performs bot warmup by making a GET request to the configured bot warmup URL. This step includes retry logic with exponential backoff (up to 3 attempts with 60-second timeout per attempt). If warmup fails, the call is marked as failed with reason "bot_not_ready" and recorded in the activeCalls collection for reporting.

#### **Step 4: Make Plivo Call**
The system makes the actual API call to Plivo with all necessary webhook URLs configured for ring, answer, and hangup events.

#### **Step 5: Track Call Start**
Upon successful Plivo API response, the system inserts a record into the activeCalls collection with the CallUUID from Plivo, marking the call as 'active' for concurrency tracking.

#### **Step 6: Rate Limiting Wait**
After processing each call, the system waits for the configured interval (default 6 seconds) before proceeding to the next call to respect rate limits and prevent API throttling.

### **Step 7: Webhook Processing**

#### **Ring URL Handler**
Receives CallUUID from Plivo when the call starts ringing. Updates the existing activeCalls record to confirm the call is properly initiated (no new insertion needed as record was created in Step 5).

#### **Hangup URL Handler**
Receives CallUUID and call completion data when the call ends. Updates the activeCalls record to mark status as 'completed', records endTime, duration, and hangup reason. This data integrates with campaign reports through the existing hangup data collection system.

### **Orphaned Campaign Recovery (Cloud Run Specific):**

#### **Container Startup Recovery**
When a new Cloud Run container starts, it immediately scans the database for campaigns marked as "running" but with stale heartbeat timestamps (older than 2 minutes). These are considered orphaned campaigns from containers that died unexpectedly.

#### **Automatic Resume Process**
Orphaned campaigns are automatically resumed by updating their status to "running", resetting the heartbeat timestamp, and starting new processing loops from their saved currentIndex position. This ensures no campaigns are lost due to container restarts, deployments, or unexpected crashes.

#### **Heartbeat Management**
Active campaigns maintain a heartbeat timer that updates the heartbeat field every 30 seconds. When campaigns are paused, cancelled, or completed, the heartbeat timer is stopped. This provides a reliable mechanism to detect dead containers versus intentionally stopped campaigns.

## Environment Variables Required

### **Concurrency Management**
```env
# Global system limits
GLOBAL_MAX_CALLS=50                    # Maximum calls across entire system

# Waiting times (milliseconds)
MAX_CONCURRENT_CALL_WAIT=5000         # Wait time when concurrency limit reached
SUBSEQUENT_CALL_WAIT=6000             # Wait time between consecutive calls

# Bot warmup settings (NEW)
BOT_WARMUP_URL=https://your-bot.com/warmup  # Bot warmup endpoint URL
BOT_WARMUP_TIMEOUT=60000              # 60 seconds timeout per warmup attempt
BOT_WARMUP_RETRIES=3                  # Maximum warmup retry attempts

# Cleanup settings
CALL_TIMEOUT_MINUTES=10               # When to mark calls as timed out
CLEANUP_INTERVAL=300000               # How often to run cleanup (5 minutes)

# Rate limiting
MAX_CALLS_PER_MINUTE=10               # Rate limit per client
RATE_LIMIT_WINDOW=60000               # Rate limit window (1 minute)
```

### **Database Settings**
```env
# MongoDB connection
MONGODB_URI=mongodb+srv://...

# Collection names (optional, defaults provided)
ACTIVE_CALLS_COLLECTION=activeCalls
CLIENT_COLLECTION=client
CAMPAIGN_COLLECTION=plivoCampaign
```

## Database Schema

### **activeCalls Collection**
```javascript
{
  _id: ObjectId,
  callUUID: String,              // From Plivo (unique identifier) or generated for failed calls
  clientId: ObjectId,            // Reference to client
  campaignId: ObjectId || null,  // Reference to campaign (null for single calls)
  from: String,                  // Calling number
  to: String,                    // Destination number  
  status: String,                // 'active' | 'completed' | 'timeout' | 'failed'
  startTime: Date,               // When call was initiated
  endTime: Date || null,         // When call ended (from hangup webhook)
  duration: Number || null,      // Call duration in seconds (from Plivo)
  endReason: String || null,     // Hangup reason (from Plivo)
  
  // Bot warmup failure tracking (NEW)
  failureReason: String || null, // 'bot_not_ready' | 'plivo_api_error' | 'timeout' | etc.
  warmupAttempts: Number || null, // Number of bot warmup attempts made
  warmupDuration: Number || null  // Total time spent on warmup attempts (ms)
}
```

### **Enhanced plivoCampaign Collection (with Pause/Resume & Heartbeat)**
The campaign collection stores all campaign state including traditional fields (campaignName, listId, fromNumber, wssUrl, clientId, createdAt) and existing tracking fields (isBalanceUpdated, isCampaignCompleted, failedCall, connectedCall).

**New fields for pause/resume functionality:**
- **status**: Enum of "running", "paused", "completed", or "cancelled" 
- **currentIndex**: Zero-based index of current contact position in the list
- **totalContacts**: Total number of contacts in the associated list
- **processedContacts**: Count of contacts processed so far
- **pausedAt**: Timestamp when campaign was paused (null if never paused)
- **pausedBy**: ObjectId of user who paused the campaign (null if never paused)
- **resumedAt**: Timestamp when campaign was last resumed (null if never resumed)

**New fields for Cloud Run heartbeat functionality:**
- **heartbeat**: Timestamp updated every 30 seconds while campaign is actively processing
- **lastActivity**: Timestamp updated after each call attempt (successful or failed)
- **containerId**: Identifier of the Cloud Run container currently processing this campaign

### **Enhanced client Collection**
The client collection stores user information and configuration including traditional fields (email, name, company, apiKey) and existing application fields.

**New fields for concurrency management:**
- **maxConcurrentCalls**: Maximum concurrent calls allowed for this client (defaults to 10, configurable per client)

## API Endpoints

### **Single Call Endpoint**
**POST /plivo/single-call**: Initiates a single call with from/to numbers, WebSocket URL, and client ID. Processes through the complete single call logic including concurrency checks, bot warmup, and call tracking.

### **Campaign Endpoint**  
**POST /plivo/create-campaign**: Creates a new campaign with campaign name, contact list ID, from number, WebSocket URL, and client ID. Initializes the campaign record and starts background processing with heartbeat tracking.

### **Campaign Pause/Resume Endpoints**

**POST /plivo/pause-campaign**: Pauses an active campaign by updating its status to "paused". The processing loop will detect this status change and stop gracefully, along with stopping the heartbeat timer.

**POST /plivo/resume-campaign**: Resumes a paused campaign by updating its status to "running", resetting the heartbeat timestamp, and starting a new processing loop from the saved currentIndex position.

**GET /plivo/campaign-progress/:campaignId**: Returns comprehensive campaign progress information including:
- Current status (running/paused/completed/cancelled)
- Progress metrics (current index, total contacts, percentage complete)
- Timing information (start time, pause time, estimated completion)
- Call statistics (connected, failed, pending calls)
- Heartbeat status for container health monitoring

### **Active Calls Monitoring**
**GET /plivo/active-calls**: Returns real-time active calls monitoring data with global system metrics (active, max, available calls) and optional client-specific metrics when clientId parameter is provided. Includes utilization percentages and optional detailed call list with includeCalls parameter.

## Background Processes

### **Timeout Cleanup Process**
Runs periodically to identify and clean up stale active calls that exceed the configured timeout duration. This self-healing mechanism prevents abandoned calls from permanently occupying concurrency slots.

### **Heartbeat Management**
Each active campaign maintains a heartbeat timer that updates the heartbeat timestamp every 30 seconds to indicate the container is alive and processing. This is essential for orphaned campaign detection.

### **Orphaned Campaign Recovery**
On container startup, the system scans for campaigns marked as "running" but with stale heartbeat timestamps, automatically resuming them from their saved progress position.

### **Health Monitoring**
Continuous monitoring of system health including concurrency utilization, campaign progress rates, failed call patterns, and container heartbeat status for operational visibility.

## Error Handling

### **Graceful Degradation**
The system implements fail-safe mechanisms including database unavailability fallbacks, Plivo API retry logic with exponential backoff, and timeout cleanup for stale webhook records. Individual call failures do not break entire campaigns.

### **Campaign Resilience**
Campaign processing continues despite individual call failures, with proper error logging and statistics tracking. Container failures are automatically detected and recovered through heartbeat monitoring and startup recovery processes.

### **Monitoring & Observability**
Comprehensive monitoring covers concurrency utilization thresholds, failed call rate patterns, database connection health, webhook delivery success rates, and container heartbeat status for operational awareness.

## Cloud Run Specific Considerations

### **Container Lifecycle Management**
The system handles Cloud Run container shutdowns gracefully by detecting SIGTERM signals and pausing active campaigns. New containers automatically resume orphaned campaigns on startup.

### **Stateless Design Benefits**
All state is stored in the database, making the system resilient to container restarts and enabling seamless horizontal scaling across multiple Cloud Run instances.

### **Cost Optimization**
The heartbeat-based design ensures containers only run when actively processing campaigns, optimizing Cloud Run costs while maintaining high availability through automatic recovery mechanisms.