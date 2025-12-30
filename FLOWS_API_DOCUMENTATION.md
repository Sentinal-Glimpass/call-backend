# Flow Variables API Documentation

## Overview

The Flow Variables API provides endpoints for managing flow-based agent conversations in the uniPipe system. This API allows you to:

1. Check if an agent has a flow assigned
2. Retrieve flow data (prompts and configs)
3. Update flow prompts
4. Update flow configuration values

All flow data is stored in **Redis db=3** for easy editing without code changes.

## Base URL

```
http://localhost:8080/api/flows
```

## Authentication

All endpoints require JWT authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

To obtain a JWT token, use the `/interlogue/get-client` endpoint:

```bash
curl -X POST http://localhost:8080/interlogue/get-client \
  -H "Content-Type: application/json" \
  -d '{"email": "your@email.com", "password": "yourpassword"}'
```

---

## Endpoints

### 1. Check Agent Flow Assignment

Check if a specific agent has a flow assigned and get flow details.

**Endpoint:** `GET /api/flows/agent/:agentId`

**Parameters:**
- `agentId` (path) - The agent/assistant ID

**Response:**
```json
{
  "hasFlow": true,
  "flowName": "neetprep_lead_qualifier",
  "flowPath": "production/neetprep_lead_qualifier",
  "description": "NEETPrep - Lead qualifier Vibhuti (Hinglish)"
}
```

**Example:**
```bash
curl -X GET http://localhost:8080/api/flows/agent/69320c340633f489136754ef \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Behavior:**
1. First attempts to query the uniPipe server API
2. Falls back to reading `flow_mapping.json` directly if API is unavailable
3. Returns `hasFlow: false` if no flow is assigned

---

### 2. Get Flow Data

Retrieve all prompts, configs, and metadata for a specific flow.

**Endpoint:** `GET /api/flows/:flowName`

**Parameters:**
- `flowName` (path) - The flow name (without directory prefix)

**Response:**
```json
{
  "name": "neetprep_lead_qualifier",
  "meta": {
    "description": "NEETPrep lead qualification flow",
    "category": "production",
    "version": "1.0"
  },
  "prompts": {
    "role_prompt": "You are Vibhuti, a friendly admission counselor...",
    "conversation_task": "Your task is to qualify leads...",
    "callback_task": "Schedule a callback for the user...",
    "end_task": "Say goodbye to the user..."
  },
  "configs": {
    "counselor_number": "+919876543210",
    "transfer_api_endpoint": "/api/transfer-call",
    "callback_api_endpoint": "/api/schedule-callback"
  }
}
```

**Example:**
```bash
curl -X GET http://localhost:8080/api/flows/neetprep_lead_qualifier \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Notes:**
- Returns all prompts matching `flow:{flowName}:prompt:*`
- Returns all configs matching `flow:{flowName}:config:*`
- Returns 404 if flow doesn't exist

---

### 3. Update Flow Prompt

Update a specific prompt for a flow.

**Endpoint:** `PUT /api/flows/:flowName/prompts/:promptName`

**Parameters:**
- `flowName` (path) - The flow name
- `promptName` (path) - The prompt name (e.g., "role_prompt", "conversation_task")

**Request Body:**
```json
{
  "content": "You are Vibhuti, a friendly and knowledgeable admission counselor..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Prompt updated successfully",
  "key": "flow:neetprep_lead_qualifier:prompt:role_prompt"
}
```

**Example:**
```bash
curl -X PUT http://localhost:8080/api/flows/neetprep_lead_qualifier/prompts/role_prompt \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "You are Vibhuti, a friendly admission counselor..."}'
```

**Common Prompt Names:**
- `role_prompt` - AI persona definition
- `conversation_task` - Main conversation instructions
- `callback_task` - Callback scheduling instructions
- `end_task` - Goodbye message instructions
- `pitch_and_offer_task` - Sales pitch script
- `whatsapp_collection_task` - WhatsApp number collection

**Important:**
- Prompt changes are cached by the bot
- Bot restart may be required for changes to take effect
- Use descriptive prompt names that indicate their purpose

---

### 4. Update Flow Config

Update a specific configuration value for a flow.

**Endpoint:** `PUT /api/flows/:flowName/configs/:configName`

**Parameters:**
- `flowName` (path) - The flow name
- `configName` (path) - The config name (e.g., "counselor_number")

**Request Body:**
```json
{
  "value": "+919876543210"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Config updated successfully",
  "key": "flow:neetprep_lead_qualifier:config:counselor_number"
}
```

**Example:**
```bash
curl -X PUT http://localhost:8080/api/flows/neetprep_lead_qualifier/configs/counselor_number \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "+919876543210"}'
```

**Common Config Names:**
- `counselor_number` - Phone number for call transfers
- `transfer_api_endpoint` - API path for call transfers
- `callback_api_endpoint` - API path for scheduling callbacks
- `whatsapp_api_endpoint` - API path for WhatsApp messages

**Important:**
- Config changes apply immediately (no restart required)
- Values are stored as strings in Redis

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Bad request",
  "message": "Prompt content is required"
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing JWT token"
}
```

### 404 Not Found
```json
{
  "error": "Flow not found",
  "message": "No data found for flow: nonexistent_flow"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "Failed to retrieve flow data"
}
```

---

## Redis Key Format

All flow data is stored in Redis db=3 using the following key patterns:

| Key Pattern | Description | Example |
|-------------|-------------|---------|
| `flow:{flowName}:prompt:{promptName}` | Individual prompts | `flow:neetprep_lead_qualifier:prompt:role_prompt` |
| `flow:{flowName}:config:{configName}` | Config values | `flow:neetprep_lead_qualifier:config:counselor_number` |
| `flow:{flowName}:meta` | Flow metadata (JSON) | `flow:neetprep_lead_qualifier:meta` |
| `flows:registry` | Set of all registered flow names | `flows:registry` |

---

## Testing

A test script is provided to verify all endpoints:

```bash
# Set your credentials
export JWT_TOKEN="your_jwt_token_here"
# or
export TEST_EMAIL="your@email.com"
export TEST_PASSWORD="yourpassword"

# Run tests
node test-flows-api.js
```

---

## Integration with uniPipe

The Flow Variables API integrates with the uniPipe system:

1. **Flow Mapping:** Agent-to-flow mappings are stored in `/home/rishi/uniPipe/flows/flow_mapping.json`
2. **Flow Registration:** Flows are registered to Redis using `/home/rishi/uniPipe/flows/register_prompts.py`
3. **uniPipe Server:** The uniPipe server runs at `https://testbot.glimpass.com` (port 9000)
4. **Redis Storage:** All flow data is stored in Redis db=3 at `10.50.107.67:6379`

---

## Environment Variables

Add these to your `.env` file:

```bash
# Redis Configuration
REDIS_HOST=10.50.107.67
REDIS_PORT=6379

# uniPipe Server Configuration
UNIPIPE_SERVER_URL=https://testbot.glimpass.com
UNIPIPE_PATH=/home/rishi/uniPipe
```

---

## Best Practices

### For Prompts
1. **Be specific:** Clear instructions produce better results
2. **Include examples:** Show the AI expected responses
3. **Define boundaries:** What the AI should NOT do
4. **Keep it concise:** Voice responses should be short (under 100 words)

### For Configs
1. **Use descriptive names:** Make purpose clear (e.g., `counselor_number` not `phone`)
2. **Validate values:** Ensure phone numbers, URLs, etc. are correctly formatted
3. **Document changes:** Keep track of config changes for debugging

### Security
1. **Always use JWT authentication:** Never expose these endpoints publicly
2. **Validate input:** The API validates required fields
3. **Audit changes:** All changes are logged via the audit middleware

---

## Troubleshooting

### "Flow not found" Error
- Verify the flow is registered in Redis using `python flows/register_prompts.py --list`
- Check if the flow name is correct (no directory prefix needed)

### "Cannot connect to Redis"
- Verify Redis is running: `redis-cli -h 10.50.107.67 -p 6379 ping`
- Check network connectivity to Redis host
- Verify environment variables are set correctly

### "Agent has no flow assigned"
- Check `flow_mapping.json` for the agent ID
- Verify the agent ID is correct (with or without `test_` prefix)
- Contact admin to assign a flow to the agent

---

## Support

For issues or questions:
1. Check the logs in `/home/rishi/call-backend/logs`
2. Review the Redis data using `redis-cli -h 10.50.107.67 -p 6379 -n 3`
3. Contact the development team

---

## Swagger Documentation

Full API documentation is available at:
```
http://localhost:8080/api-docs
```

Navigate to the "Flows" section to see interactive API documentation.
