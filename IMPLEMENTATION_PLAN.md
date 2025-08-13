# Telephony System Implementation Plan

## Overview
This document outlines the step-by-step implementation plan to transform the current basic telephony system into a robust, serverless-ready system with advanced campaign management, pause/resume functionality, and automatic orphaned campaign recovery.

## Phase 1: Preparation & Database Schema Setup

### Step 1.1: Environment Variables Setup
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Update .env file with all required configuration variables

Add the following variables to .env file:
- `GLOBAL_MAX_CALLS=50` - System-wide concurrent call limit
- `MAX_CONCURRENT_CALL_WAIT=5000` - Wait time when limits reached (ms)
- `SUBSEQUENT_CALL_WAIT=6000` - Wait between consecutive calls (ms)
- `BOT_WARMUP_URL=https://your-bot.com/warmup` - Bot warmup endpoint
- `BOT_WARMUP_TIMEOUT=60000` - Bot warmup timeout per attempt (ms)
- `BOT_WARMUP_RETRIES=3` - Maximum warmup retry attempts
- `CALL_TIMEOUT_MINUTES=10` - When to mark calls as timed out
- `CLEANUP_INTERVAL=300000` - Cleanup process interval (ms)
- `HEARTBEAT_INTERVAL=30000` - Campaign heartbeat update interval (ms)
- `ORPHAN_DETECTION_THRESHOLD=120000` - Stale heartbeat threshold (ms)

### Step 1.2: Database Schema Validation Script
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Create test script to validate current database schema and identify required changes

Create `scripts/validateSchema.js` to:
- Check existing client collection structure
- Verify plivoCampaign collection exists and current fields
- Test activeCalls collection creation (new collection)
- Validate MongoDB indexes are properly set
- Report schema gaps and required migrations

### Step 1.3: Client Schema Enhancement Testing
**Status**: ✅ PARTIALLY IMPLEMENTED
**Changes Required**: Add maxConcurrentCalls default handling in existing insertClient function

Current state: The insertClient function in `src/apps/interLogue/client.js` exists but needs enhancement.
Required changes:
- Ensure maxConcurrentCalls field defaults to 10 for new clients
- Add validation for maxConcurrentCalls field
- Test client creation with new schema

### Step 1.4: Campaign Collection Preparation
**Status**: ❌ NOT IMPLEMENTED  
**Objective**: Prepare plivoCampaign collection for new fields

Required new fields to add:
- status (enum: "running", "paused", "completed", "cancelled")
- currentIndex (number, default: 0)
- totalContacts (number, calculated from list)
- processedContacts (number, default: 0)
- heartbeat (timestamp, updated every 30s)
- lastActivity (timestamp, updated after each call)
- containerId (string, identifies processing container)
- pausedAt, pausedBy, resumedAt (optional timestamps)

### Step 1.5: ActiveCalls Collection Setup
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Create new activeCalls collection for concurrency tracking

Collection schema requirements:
- callUUID (string, from Plivo)
- clientId (ObjectId reference)
- campaignId (ObjectId reference, nullable)
- from/to (phone numbers)
- status (enum: "active", "completed", "failed", "timeout")
- timestamps (startTime, endTime)
- failure tracking (failureReason, warmupAttempts, warmupDuration)

## Phase 2: Core Infrastructure Implementation

### Step 2.1: Bot Warmup Integration
**Status**: ✅ IMPLEMENTED
**Location**: `src/utils/botWarmup.js`

The bot warmup utility is already implemented with:
- Retry logic (3 attempts with exponential backoff)
- Timeout handling (60 seconds per attempt)
- Comprehensive error handling and logging

No changes required - this component is ready for integration.

### Step 2.2: Concurrency Management System
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Create database-driven concurrency checking

Required components:
- Function to atomically check client concurrency limits
- Function to check global system limits
- Wait mechanism when limits are reached
- Integration with existing activeCalls tracking

Key logic: Query activeCalls collection for current counts, compare against client.maxConcurrentCalls and GLOBAL_MAX_CALLS environment variable.

### Step 2.3: Active Calls Tracking System
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Replace in-memory activeCalls with database tracking

Current system uses: `src/apps/helper/activeCalls.js` with in-memory Map
Target system: Database collection with proper lifecycle management

Required functions:
- trackCallStart (insert record when call initiated)
- trackCallEnd (update record when call completes)  
- cleanupTimeoutCalls (periodic cleanup of stale records)
- getConcurrencyStats (for monitoring endpoints)

### Step 2.4: Enhanced Webhook Handlers
**Status**: 🔄 PARTIALLY IMPLEMENTED
**Changes Required**: Integrate with database tracking system

Current webhook handlers in `src/routes/plivoRouter.js`:
- ring-url handler: Exists but uses in-memory tracking
- hangup-url handler: Exists but uses in-memory tracking

Required changes:
- Update to use database-driven activeCalls tracking
- Extract clientId from campaign data or webhook parameters
- Integrate with concurrency management system

## Phase 3: Campaign Management System

### Step 3.1: Enhanced Campaign Creation
**Status**: 🔄 PARTIALLY IMPLEMENTED  
**Changes Required**: Add new schema fields and heartbeat initialization

Current: `makeCallViaCampaign` function exists in `src/apps/plivo/plivo.js`
Required enhancements:
- Initialize new campaign fields (status, currentIndex, totalContacts, etc.)
- Set up heartbeat timer when campaign starts
- Calculate and store total contacts count
- Generate unique containerId for tracking

### Step 3.2: Campaign Processing Loop Redesign
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Replace simple loop with pause-aware, heartbeat-enabled processing

Current system: Basic for loop without pause capability
Target system: Stateful loop that checks campaign status before each call

Key features:
- Check campaign.status before each iteration
- Update currentIndex for progress tracking  
- Maintain heartbeat timer throughout processing
- Graceful handling of pause/cancel commands
- Resume from exact position capability

### Step 3.3: Single Call Processing Unification
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Create unified processSingleCall function used by both single calls and campaigns

This function should handle:
- Concurrency limit checking and waiting
- Bot warmup with retry logic
- Plivo API call execution
- Call tracking in activeCalls collection
- Rate limiting delays
- Error handling and reporting

Both single-call API and campaign processing should use this unified function.

## Phase 4: Pause/Resume Functionality

### Step 4.1: Campaign Pause API Implementation
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Create endpoint to pause active campaigns

API endpoint: `POST /plivo/pause-campaign`
Required functionality:
- Validate campaign ownership and permissions
- Update campaign status to "paused"
- Set pausedAt timestamp and pausedBy user ID
- Stop heartbeat timer
- Return success response

The processing loop will detect status change and stop gracefully.

### Step 4.2: Campaign Resume API Implementation  
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Create endpoint to resume paused campaigns

API endpoint: `POST /plivo/resume-campaign`
Required functionality:
- Validate campaign is in "paused" state
- Update status to "running" and set resumedAt timestamp
- Reset heartbeat timer
- Start new processing loop from saved currentIndex
- Handle multiple resume requests gracefully

### Step 4.3: Campaign Progress Monitoring
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Create endpoint for real-time campaign progress tracking

API endpoint: `GET /plivo/campaign-progress/:campaignId`
Response should include:
- Current campaign status and position
- Progress percentages and remaining contacts
- Timing information and estimated completion
- Call statistics (connected, failed, pending)
- Container health status via heartbeat

## Phase 5: Cloud Run Serverless Optimization

### Step 5.1: Container Heartbeat System
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Implement heartbeat mechanism for orphaned campaign detection

Required components:
- Heartbeat timer that updates campaign.heartbeat every 30 seconds
- Container identification system (unique containerId per instance)
- Heartbeat stops when campaign pauses, completes, or container shuts down

Integration points:
- Start heartbeat when campaign processing begins
- Update during active processing loop
- Stop on pause/complete/error conditions

### Step 5.2: Orphaned Campaign Recovery System
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Automatic detection and recovery of abandoned campaigns

Key components:
- Startup scanner: Find campaigns with stale heartbeats on container startup
- Recovery logic: Resume orphaned campaigns from their saved currentIndex
- Container shutdown handling: Graceful pause of campaigns on SIGTERM signal

Recovery criteria: Campaigns with status="running" but heartbeat older than 2 minutes are considered orphaned.

### Step 5.3: Container Lifecycle Management
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Handle Cloud Run container startup and shutdown gracefully

Startup process:
- Scan database for orphaned campaigns
- Auto-resume campaigns from previous containers
- Initialize monitoring and cleanup processes

Shutdown process:
- Listen for SIGTERM signals
- Pause all active campaigns
- Clean up heartbeat timers
- Exit gracefully

## Phase 6: Monitoring and Administration

### Step 6.1: Enhanced Active Calls Monitoring  
**Status**: 🔄 PARTIALLY IMPLEMENTED
**Changes Required**: Integrate with database-driven system

Current endpoint: `GET /plivo/get-active-channels` returns in-memory data
Required enhancement: Update to use activeCalls collection data

New features to add:
- Client-specific filtering with `?clientId=` parameter
- Detailed call list with `?includeCalls=true` parameter
- Real-time utilization percentages
- Container health indicators

### Step 6.2: Campaign Management Dashboard Support
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Provide comprehensive campaign monitoring capabilities

Required endpoints:
- List all campaigns for a client with status filtering
- Campaign statistics and performance metrics
- Failed call analysis and retry recommendations
- System health and capacity monitoring

### Step 6.3: Database Indexes and Performance
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Optimize database performance for concurrent operations

Required indexes:
- `plivoCampaign`: {status: 1, heartbeat: 1} for orphan detection
- `plivoCampaign`: {clientId: 1, status: 1} for client queries
- `activeCalls`: {status: 1, clientId: 1} for concurrency checks
- `activeCalls`: {status: 1} for global counts
- `activeCalls`: {startTime: 1} for timeout cleanup

## Phase 7: Testing and Validation

### Step 7.1: Unit Testing Framework
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Comprehensive testing of core components

Test coverage needed:
- Concurrency management logic
- Campaign pause/resume functionality  
- Bot warmup retry mechanisms
- Database schema validation
- Error handling scenarios

### Step 7.2: Integration Testing
**Status**: ❌ NOT IMPLEMENTED  
**Objective**: End-to-end system validation

Test scenarios:
- Full campaign lifecycle (create → process → pause → resume → complete)
- Container failure and recovery simulation
- Concurrent campaign processing across multiple clients
- Rate limiting and concurrency enforcement
- Webhook processing and call tracking

### Step 7.3: Load Testing Preparation
**Status**: ❌ NOT IMPLEMENTED
**Objective**: Validate system performance under load

Load test scenarios:
- Multiple concurrent campaigns from different clients
- High-frequency single call processing
- Database performance under concurrent operations
- Container scaling behavior on Cloud Run
- Memory usage during long-running campaigns

## Implementation Priority

**Phase 1** (Critical Foundation): Steps 1.1-1.5 must be completed first
**Phase 2** (Core Infrastructure): Steps 2.1-2.4 enable basic functionality  
**Phase 3** (Campaign Management): Steps 3.1-3.3 provide campaign capabilities
**Phase 4** (Pause/Resume): Steps 4.1-4.3 add advanced controls
**Phase 5** (Serverless Optimization): Steps 5.1-5.3 ensure Cloud Run readiness
**Phase 6-7** (Monitoring/Testing): Final polish and validation

Each phase builds upon the previous phase. Testing should be conducted incrementally after each major component implementation.