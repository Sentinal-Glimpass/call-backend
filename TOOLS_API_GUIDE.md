# Tools API Complete Guide

## Overview

The Tools API provides a clean, service-based architecture for managing communication tools:

- **WATI Tools**: WhatsApp messaging via WATI platform
- **Gmail Tools**: Gmail/SMTP email messaging
- **Future Tools**: Easy to add new providers (SMS, Slack, etc.)

## Base URLs

- **WATI Tools**: `/api/tools/wati`
- **Gmail Tools**: `/api/tools/gmail`

## Authentication

- **JWT Token**: Client operations (`Authorization: Bearer <jwt_token>`)
- **Super Key**: Admin operations and bot integration (`Authorization: Bearer <super_key>`)

---

## WATI Tools API

### Tool Management

```
GET    /api/tools/wati                        // List WATI tools
POST   /api/tools/wati                        // Create WATI tool
GET    /api/tools/wati/{toolId}               // Get specific WATI tool
PUT    /api/tools/wati/{toolId}               // Update WATI tool
DELETE /api/tools/wati/{toolId}               // Delete WATI tool
```

### Templates

```
GET    /api/tools/wati/templates              // Get WATI templates from API
```

### Agent Assignments

```
GET    /api/tools/wati/agents/{agentId}              // Get agent's WATI tools
POST   /api/tools/wati/agents/{agentId}/assign       // Assign WATI tool to agent
DELETE /api/tools/wati/agents/{agentId}/remove       // Remove WATI tool from agent
PUT    /api/tools/wati/agents/{agentId}/toggle       // Enable/disable WATI tool
```

### Bot Integration

```
GET    /api/tools/wati/bot/{agentId}          // Get complete WATI config for bot (Super Key)
```

---

## Gmail Tools API

### Tool Management

```
GET    /api/tools/gmail                       // List email tools
POST   /api/tools/gmail                       // Create email tool
GET    /api/tools/gmail/{toolId}              // Get specific email tool
PUT    /api/tools/gmail/{toolId}              // Update email tool
DELETE /api/tools/gmail/{toolId}              // Delete email tool
```

### Templates & Configuration

```
GET    /api/tools/gmail/templates/types       // Get email template types
POST   /api/tools/gmail/test-config           // Test email configuration
```

### Agent Assignments

```
GET    /api/tools/gmail/agents/{agentId}             // Get agent's email tools
POST   /api/tools/gmail/agents/{agentId}/assign      // Assign email tool to agent
DELETE /api/tools/gmail/agents/{agentId}/remove      // Remove email tool from agent
PUT    /api/tools/gmail/agents/{agentId}/toggle      // Enable/disable email tool
```

### Bot Integration

```
GET    /api/tools/gmail/bot/{agentId}         // Get complete email config for bot (Super Key)
```

---

## Database Collections

### watiTools
```javascript
{
  client_id: "client_123",
  tool_name: "urgent_support_wati",
  description: "Urgent customer support messages",
  template_id: "urgent_support_template",
  language: "en",
  variables: ["customer_name", "issue_type"],
  strategy: "immediate",
  conditions: ["high_priority"],
  enabled: true,
  created_at: Date,
  updated_at: Date
}
```

### agentWatiTools
```javascript
{
  agent_id: "agent_123",
  client_id: "client_123",
  assigned_tools: [{
    wati_tool_id: ObjectId,
    enabled: true,
    conditions_override: ["emergency_only"],
    parameters_override: {language: "es"}
  }],
  created_at: Date,
  updated_at: Date
}
```

### emailTools
```javascript
{
  client_id: "client_123",
  tool_name: "welcome_email",
  description: "Welcome new users",
  email_type: "welcome",
  subject: "Welcome to {{company_name}}!",
  body: "Hi {{user_name}}, welcome...",
  variables: ["user_name", "company_name"],
  strategy: "immediate",
  conditions: ["user_registered"],
  enabled: true,
  created_at: Date,
  updated_at: Date
}
```

### agentEmailTools
```javascript
{
  agent_id: "agent_123",
  client_id: "client_123",
  assigned_tools: [{
    email_tool_id: ObjectId,
    enabled: true,
    conditions_override: ["vip_user_only"],
    parameters_override: {subject: "VIP Welcome!"}
  }],
  created_at: Date,
  updated_at: Date
}
```

---

## Credentials Management

All credentials are now managed per-client via the credentials API. No environment variables needed.

### Adding WATI Credentials (per client)
```bash
curl -X POST /telephony-credentials/add \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "client_123",
    "provider": "wati",
    "wati_api_key": "your_wati_api_key",
    "wati_instance_id": "123456"
  }'
```

### Adding Email Credentials (per client)
```bash
curl -X POST /telephony-credentials/add \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "client_123",
    "provider": "email",
    "gmail_user": "agent@markaible.com",
    "gmail_password": "app_specific_password"
  }'
```

### Enable Providers for Client
```bash
curl -X PUT /provider-config/providers \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "client_123",
    "providers": {
      "wati_active": true,
      "email_active": true
    }
  }'
```

---

## Quick Start Examples

### 1. Create WATI Tool
```bash
# Get available templates
curl -H "Authorization: Bearer <jwt_token>" \
     http://localhost:8080/api/tools/wati/templates

# Create WATI tool
curl -X POST \
     -H "Authorization: Bearer <jwt_token>" \
     -H "Content-Type: application/json" \
     -d '{"tool_name":"urgent_support_wati","template_id":"urgent_template","description":"Urgent support messages","language":"en","variables":["customer_name"],"strategy":"immediate","conditions":["high_priority"]}' \
     http://localhost:8080/api/tools/wati
```

### 2. Create Gmail Tool
```bash
curl -X POST \
     -H "Authorization: Bearer <jwt_token>" \
     -H "Content-Type: application/json" \
     -d '{
       "tool_name": "welcome_email",
       "email_type": "welcome",
       "subject": "Welcome to {{company_name}}!",
       "body": "Hi {{user_name}}, welcome to our platform!",
       "variables": ["user_name", "company_name"],
       "strategy": "immediate",
       "conditions": ["user_registered"]
     }' \
     http://localhost:8080/api/tools/gmail
```

### 3. Assign Tools to Agent
```bash
# Assign WATI tool
curl -X POST \
     -H "Authorization: Bearer <jwt_token>" \
     -H "Content-Type: application/json" \
     -d '{"wati_tool_id":"tool_id_here","enabled":true}' \
     http://localhost:8080/api/tools/wati/agents/agent_123/assign

# Assign email tool
curl -X POST \
     -H "Authorization: Bearer <jwt_token>" \
     -H "Content-Type: application/json" \
     -d '{"email_tool_id":"email_tool_id_here","enabled":true}' \
     http://localhost:8080/api/tools/gmail/agents/agent_123/assign
```

### 4. Bot Integration
```bash
# Get WATI tools for bot
curl -H "Authorization: Bearer <super_key>" \
     http://localhost:8080/api/tools/wati/bot/agent_123

# Get email tools for bot
curl -H "Authorization: Bearer <super_key>" \
     http://localhost:8080/api/tools/gmail/bot/agent_123
```

---

## Bot Integration Response Format

### WATI Bot Response
```json
{
  "success": true,
  "agent_id": "agent_123",
  "client_id": "client_123",
  "wati_tools": [
    {
      "wati_tool_id": "tool_123",
      "tool_name": "urgent_support_wati",
      "mcp_identifier": "wati_send_message",
      "template_id": "urgent_template",
      "final_parameters": {
        "template_id": "urgent_template",
        "language": "es"
      },
      "final_conditions": ["emergency_only"],
      "encrypted_credentials": "AES256_BLOB_HERE"
    }
  ]
}
```

### Email Bot Response
```json
{
  "success": true,
  "agent_id": "agent_123",
  "client_id": "client_123",
  "email_tools": [
    {
      "email_tool_id": "email_123",
      "tool_name": "welcome_email",
      "mcp_identifier": "gmail_send_email",
      "email_type": "welcome",
      "final_parameters": {
        "subject": "Welcome to {{company_name}}!",
        "body": "Hi {{user_name}}...",
        "variables": ["user_name", "company_name"]
      },
      "encrypted_credentials": "AES256_BLOB_HERE"
    }
  ]
}
```

---

## Email Template Types

1. **welcome** - Welcome new users
2. **notification** - System notifications
3. **followup** - Follow-up on leads
4. **reminder** - Appointment reminders
5. **support** - Customer support responses
6. **custom** - Custom templates

---

## Execution Strategies

1. **immediate** - Execute immediately when conditions met
2. **conditional** - Execute only when specific conditions satisfied
3. **scheduled** - Execute at scheduled times
4. **manual** - Execute only when manually triggered

---

## Benefits of Service-Based Architecture

✅ **Simple**: No complex registry to manage
✅ **Tool-Specific**: Each provider has custom logic
✅ **Scalable**: Easy to add new tool types
✅ **Flexible**: Agent-level assignments and overrides
✅ **Secure**: Encrypted credential transmission
✅ **Clean APIs**: Intuitive endpoint structure

---

## Adding New Tool Types

To add a new tool type (e.g., SMS, Slack):

1. Create service: `src/services/tools/smsService.js`
2. Create router: `src/routes/tools/smsRouter.js`
3. Add collections: `smsTools`, `agentSmsTools`
4. Add credentials: Update credential service
5. Mount router: `app.use('/api/tools/sms', smsRouter)`

---

## Error Handling

All endpoints return consistent error format:
```json
{
  "success": false,
  "status": 400,
  "message": "Detailed error message",
  "error": "Technical error details"
}
```

Common status codes:
- **400**: Validation errors, duplicates
- **401**: Missing authentication
- **403**: Invalid credentials
- **404**: Resource not found
- **500**: Internal server error

---

## Interactive Documentation

Complete Swagger documentation: `http://localhost:8080/api-docs`