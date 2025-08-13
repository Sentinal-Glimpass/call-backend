# Enhanced Telephony System - Frontend Integration Guide

## Overview
This document outlines all API endpoints and parameter changes for the enhanced telephony system with advanced campaign management, database-driven concurrency, and Cloud Run optimization.

---

## 🔐 Authentication Requirements

All protected endpoints require JWT authentication:

```bash
Authorization: Bearer <your_jwt_token>
```

For API key protected endpoints, use:
```bash
x-api-key: <your_api_key>
```

---

## 📞 Campaign Management Endpoints

### 1. Create Campaign (Enhanced)
**Endpoint:** `POST /plivo/create-campaign`  
**Authentication:** JWT Required  
**Status:** ✅ Enhanced (backward compatible)

**Request Body:**
```json
{
  "campaignName": "string (required, 1-100 chars)",
  "listId": "string (required, MongoDB ObjectId)",
  "fromNumber": "string (required, phone number format)",
  "wssUrl": "string (required, WebSocket URL - ws:// or wss://)",
  "clientId": "string (optional, if not in JWT)"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Campaign created successfully",
  "campaignId": "string (MongoDB ObjectId)",
  "data": {
    "campaignId": "string",
    "campaignName": "string",
    "status": "running",
    "totalContacts": "number",
    "currentIndex": 0,
    "heartbeat": "timestamp",
    "createdAt": "timestamp"
  }
}
```

### 2. Pause Campaign (NEW)
**Endpoint:** `POST /plivo/pause-campaign`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**Request Body:**
```json
{
  "campaignId": "string (required, MongoDB ObjectId)",
  "pausedBy": "string (optional, user identifier)"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Campaign paused successfully",
  "campaignId": "string"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Campaign not found or already paused"
}
```

### 3. Resume Campaign (NEW)
**Endpoint:** `POST /plivo/resume-campaign`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**Request Body:**
```json
{
  "campaignId": "string (required, MongoDB ObjectId)"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Campaign resumed successfully",
  "campaignId": "string",
  "resumedFrom": {
    "currentIndex": "number",
    "remainingContacts": "number"
  }
}
```

### 4. Campaign Progress Monitoring (NEW)
**Endpoint:** `GET /plivo/campaign-progress/:campaignId`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**URL Parameters:**
- `campaignId` (string, required): MongoDB ObjectId

**Response:**
```json
{
  "success": true,
  "campaignId": "string",
  "progress": {
    "status": "running|paused|completed|cancelled|failed",
    "currentIndex": "number",
    "totalContacts": "number",
    "processedContacts": "number",
    "progressPercentage": "number (0-100)",
    "remainingContacts": "number"
  },
  "statistics": {
    "connectedCalls": "number",
    "failedCalls": "number",
    "totalCallsAttempted": "number",
    "avgCallDuration": "number (seconds)"
  },
  "timing": {
    "startTime": "timestamp",
    "pausedAt": "timestamp|null",
    "resumedAt": "timestamp|null",
    "lastActivity": "timestamp",
    "estimatedCompletion": "timestamp|null"
  },
  "container": {
    "containerId": "string",
    "heartbeat": "timestamp",
    "heartbeatStatus": "active|stale"
  }
}
```

---

## 📊 Dashboard & Analytics Endpoints (NEW)

### 1. Campaign Dashboard
**Endpoint:** `GET /plivo/dashboard/campaigns`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**Query Parameters:**
- `page` (number, optional, default: 1): Page number for pagination
- `limit` (number, optional, default: 20): Items per page (max 100)
- `status` (string, optional): Filter by status (running|paused|completed|cancelled|failed)
- `sortBy` (string, optional, default: createdAt): Sort field
- `sortOrder` (string, optional, default: desc): Sort order (asc|desc)

**Response:**
```json
{
  "success": true,
  "campaigns": [
    {
      "campaignId": "string",
      "campaignName": "string",
      "status": "string",
      "progress": {
        "percentage": "number",
        "processed": "number",
        "total": "number"
      },
      "statistics": {
        "connected": "number",
        "failed": "number"
      },
      "timing": {
        "created": "timestamp",
        "lastActivity": "timestamp"
      },
      "heartbeat": "active|stale"
    }
  ],
  "pagination": {
    "currentPage": "number",
    "totalPages": "number",
    "totalCampaigns": "number",
    "hasNext": "boolean",
    "hasPrevious": "boolean"
  },
  "summary": {
    "totalActive": "number",
    "totalPaused": "number",
    "totalCompleted": "number"
  }
}
```

### 2. System Statistics
**Endpoint:** `GET /plivo/dashboard/stats`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**Response:**
```json
{
  "success": true,
  "statistics": {
    "campaigns": {
      "total": "number",
      "running": "number",
      "paused": "number",
      "completed": "number",
      "failed": "number"
    },
    "calls": {
      "totalToday": "number",
      "totalThisWeek": "number",
      "totalThisMonth": "number",
      "successRate": "number (percentage)"
    },
    "concurrency": {
      "currentActive": "number",
      "maxAllowed": "number",
      "utilizationPercentage": "number"
    },
    "performance": {
      "avgCampaignDuration": "number (hours)",
      "avgCallsPerMinute": "number",
      "systemHealth": "healthy|warning|critical"
    }
  },
  "timestamp": "timestamp"
}
```

### 3. Failed Calls Analysis
**Endpoint:** `GET /plivo/dashboard/failed-calls`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**Query Parameters:**
- `days` (number, optional, default: 7): Number of days to analyze
- `campaignId` (string, optional): Filter by specific campaign

**Response:**
```json
{
  "success": true,
  "analysis": {
    "totalFailed": "number",
    "failureReasons": [
      {
        "reason": "string",
        "count": "number",
        "percentage": "number"
      }
    ],
    "recommendations": [
      {
        "type": "string",
        "description": "string",
        "priority": "high|medium|low"
      }
    ],
    "trends": {
      "dailyFailures": [
        {
          "date": "date",
          "count": "number"
        }
      ]
    }
  }
}
```

### 4. Bulk Operations
**Endpoint:** `POST /plivo/dashboard/bulk-operations`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**Request Body:**
```json
{
  "action": "pause|resume|cancel",
  "campaignIds": ["string", "string", ...],
  "reason": "string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "results": {
    "successful": ["campaignId1", "campaignId2"],
    "failed": [
      {
        "campaignId": "string",
        "error": "string"
      }
    ]
  },
  "summary": {
    "total": "number",
    "successful": "number",
    "failed": "number"
  }
}
```

---

## 🎛️ Monitoring & Analytics Endpoints (NEW)

### 1. Active Calls Monitoring
**Endpoint:** `GET /plivo/monitoring/active-calls`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**Query Parameters:**
- `includeDetails` (boolean, optional): Include detailed call information

**Response:**
```json
{
  "success": true,
  "monitoring": {
    "summary": {
      "totalActive": "number",
      "clientActive": "number",
      "globalUtilization": "number (percentage)",
      "clientUtilization": "number (percentage)"
    },
    "limits": {
      "clientMax": "number",
      "globalMax": "number",
      "clientAvailable": "number",
      "globalAvailable": "number"
    },
    "calls": [
      {
        "callUUID": "string",
        "from": "string",
        "to": "string",
        "startTime": "timestamp",
        "duration": "number (seconds)",
        "campaignId": "string|null"
      }
    ]
  },
  "timestamp": "timestamp"
}
```

### 2. System Utilization
**Endpoint:** `GET /plivo/monitoring/utilization`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**Response:**
```json
{
  "success": true,
  "utilization": {
    "concurrency": {
      "percentage": "number",
      "active": "number",
      "available": "number",
      "max": "number"
    },
    "campaigns": {
      "running": "number",
      "paused": "number",
      "load": "number (percentage)"
    },
    "callRate": {
      "last5Minutes": "number",
      "ratePerMinute": "number"
    },
    "systemStatus": "healthy|warning|critical"
  },
  "recommendations": [
    {
      "type": "string",
      "message": "string",
      "priority": "string"
    }
  ]
}
```

### 3. Analytics Dashboard
**Endpoint:** `GET /plivo/monitoring/analytics`  
**Authentication:** JWT Required  
**Status:** 🆕 New Feature

**Query Parameters:**
- `period` (string, optional, default: "24h"): Analysis period (1h|6h|24h|7d|30d)

**Response:**
```json
{
  "success": true,
  "analytics": {
    "calls": {
      "total": "number",
      "successful": "number",
      "failed": "number",
      "avgDuration": "number (seconds)",
      "peakHour": "string"
    },
    "campaigns": {
      "completed": "number",
      "avgCompletionTime": "number (hours)",
      "successRate": "number (percentage)"
    },
    "distribution": {
      "hourlyVolume": [
        {
          "hour": "number",
          "calls": "number"
        }
      ],
      "callOutcomes": [
        {
          "outcome": "string",
          "count": "number",
          "percentage": "number"
        }
      ]
    },
    "performance": {
      "responseTime": "number (ms)",
      "errorRate": "number (percentage)",
      "throughput": "number (calls/minute)"
    }
  },
  "period": "string",
  "generatedAt": "timestamp"
}
```

---

## 🏥 Health & System Monitoring (NEW)

### 1. Basic Health Check
**Endpoint:** `GET /health`  
**Authentication:** None  
**Status:** 🆕 Enhanced

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "timestamp",
  "uptime": "number (seconds)",
  "environment": "string",
  "version": "string"
}
```

### 2. Cloud Run Health
**Endpoint:** `GET /health/cloud-run`  
**Authentication:** None  
**Status:** 🆕 New Feature

**Response:**
```json
{
  "status": "healthy",
  "warnings": [],
  "container": {
    "status": "healthy",
    "containerId": "string",
    "uptime": "number",
    "managedCampaigns": "number",
    "memoryUsage": {
      "rss": "number",
      "heapTotal": "number",
      "heapUsed": "number"
    }
  },
  "campaigns": {
    "activeHeartbeats": "number",
    "staleHeartbeats": "number"
  },
  "concurrency": {
    "global": {
      "active": "number",
      "max": "number",
      "utilization": "number"
    }
  }
}
```

### 3. Database Health
**Endpoint:** `GET /health/database`  
**Authentication:** None  
**Status:** 🆕 New Feature

**Response:**
```json
{
  "status": "healthy",
  "health": {
    "status": "healthy",
    "score": "number (0-100)",
    "database": {
      "size": "number",
      "collections": "number",
      "indexes": "number"
    },
    "collections": {
      "plivoCampaign": "number",
      "activeCalls": "number",
      "client": "number"
    }
  }
}
```

### 4. Comprehensive Health
**Endpoint:** `GET /health/comprehensive`  
**Authentication:** None  
**Status:** 🆕 New Feature

**Response:**
```json
{
  "status": "healthy",
  "score": "number (0-100)",
  "components": {
    "mongodb": {"status": "healthy"},
    "container": {"status": "healthy"},
    "campaigns": {"status": "healthy"},
    "system": {"status": "healthy"}
  },
  "database": {
    "status": "healthy",
    "score": "number"
  },
  "performance": {
    "utilization": {
      "concurrency": {"percentage": "number"},
      "campaigns": {"load": "number"},
      "systemStatus": "healthy"
    }
  },
  "recommendations": [],
  "warnings": []
}
```

### 5. Integration Tests
**Endpoint:** `GET /health/integration-test`  
**Authentication:** None  
**Status:** 🆕 New Feature

**Query Parameters:**
- `suite` (string, optional, default: "basic"): Test suite to run (basic|full|performance)

**Response:**
```json
{
  "status": "passed|failed",
  "suite": "string",
  "tests": [
    {
      "name": "string",
      "passed": "boolean",
      "error": "string|null",
      "duration": "number (ms)"
    }
  ],
  "summary": {
    "total": "number",
    "passed": "number",
    "failed": "number"
  }
}
```

---

## 📞 Single Call API (Enhanced)

### Single Call
**Endpoint:** `POST /plivo/single-call`  
**Authentication:** JWT Required  
**Status:** ✅ Enhanced (backward compatible)

**Request Body:**
```json
{
  "from": "string (required, phone number)",
  "to": "string (required, phone number)",
  "wssUrl": "string (required, WebSocket URL - ws:// or wss://)",
  "clientId": "string (optional, if not in JWT)",
  "assistantId": "string (optional, MongoDB ObjectId)",
  "customPrompt": "string (optional, max 1000 chars)"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Call initiated successfully",
  "data": {
    "callUUID": "string",
    "from": "string",
    "to": "string",
    "status": "active",
    "startTime": "timestamp"
  }
}
```

---

## 📈 Active Channels (Enhanced)

### Get Active Channels
**Endpoint:** `GET /plivo/get-active-channels`  
**Authentication:** JWT Required  
**Status:** ✅ Enhanced

**Query Parameters:**
- `includeCalls` (boolean, optional): Include detailed call list
- `clientId` (string, optional): Filter by client

**Response:**
```json
{
  "success": true,
  "data": {
    "global": {
      "active": "number",
      "max": "number",
      "available": "number",
      "utilization": "number (percentage)"
    },
    "client": {
      "active": "number",
      "max": "number",
      "available": "number",
      "utilization": "number (percentage)"
    },
    "calls": [
      {
        "callUUID": "string",
        "from": "string",
        "to": "string",
        "duration": "number",
        "campaignId": "string|null"
      }
    ],
    "timestamp": "timestamp"
  }
}
```

---

## ⚠️ Error Response Format

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "string (error description)",
  "error": "string (optional technical details)",
  "code": "string (optional error code)",
  "timestamp": "timestamp"
}
```

**Common HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (missing/invalid authentication)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (resource doesn't exist)
- `500`: Internal Server Error

---

## 🔄 Migration Notes

### Backward Compatibility
✅ **All existing endpoints remain functional**  
✅ **No breaking changes to request/response formats**  
✅ **Existing authentication mechanisms preserved**

### New Features Available
- Campaign pause/resume functionality
- Real-time progress monitoring
- Advanced dashboard analytics
- System health monitoring
- Database performance tracking
- Cloud Run optimization features

### Recommended Updates
1. **Campaign Management**: Integrate new pause/resume endpoints for better user control
2. **Monitoring**: Use new dashboard endpoints for operational visibility  
3. **Health Checks**: Implement health monitoring for production deployments
4. **Analytics**: Leverage new analytics endpoints for business insights

---

## 📞 Support & Integration

For technical support or integration assistance:
- Swagger Documentation: `GET /api-docs`
- Health Status: `GET /health/comprehensive`
- Integration Tests: `GET /health/integration-test?suite=full`

All endpoints are production-ready and optimized for Google Cloud Run deployment with automatic scaling and high availability.