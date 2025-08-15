# Multi-Telephony Provider Architecture

## Overview
This document outlines the architecture for supporting multiple telephony providers (Plivo, Exotel, Twilio, etc.) in a unified, maintainable way while ensuring complete backward compatibility with existing Plivo implementation.

## Core Design Principles
1. **Zero Breaking Changes**: Existing Plivo implementation continues to work unchanged
2. **Provider Agnostic**: Frontend never needs to know which provider is being used
3. **Data Consistency**: Normalized data schema across all providers
4. **Extensibility**: Easy to add new providers without modifying core logic
5. **Gradual Migration**: Clients can be migrated one at a time

## Architecture Pattern
We use the **Adapter Pattern** with a **Factory Pattern** for provider selection and **Strategy Pattern** for provider-specific implementations.

```
┌─────────────────────────────────────────────────────────────┐
│                      Application Layer                       │
│                  (Routes, Business Logic)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Telephony Manager                         │
│                 (Factory & Orchestrator)                     │
├───────────────────────────────────────────────────────────────┤
│ - getProvider(clientId)                                        │
│ - executeCall(clientId, params)                                │
│ - normalizeWebhookData(provider, event, data)                  │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Plivo Adapter │   │Exotel Adapter│   │Twilio Adapter│
└───────────────┘   └───────────────┘   └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Plivo Mapper  │   │Exotel Mapper │   │Twilio Mapper │
└───────────────┘   └───────────────┘   └───────────────┘
```

## File Structure

```
src/
├── apps/
│   ├── telephony/                     # New telephony abstraction layer
│   │   ├── index.js                   # Main exports
│   │   ├── TelephonyManager.js        # Factory and orchestrator
│   │   ├── TelephonyInterface.js      # Base interface/abstract class
│   │   ├── constants.js               # Shared constants and enums
│   │   ├── errors.js                  # Custom error classes
│   │   │
│   │   ├── adapters/                  # Provider-specific adapters
│   │   │   ├── BaseAdapter.js         # Base adapter with common logic
│   │   │   ├── PlivoAdapter.js        # Plivo implementation
│   │   │   ├── ExotelAdapter.js       # Exotel implementation
│   │   │   ├── TwilioAdapter.js       # Twilio implementation
│   │   │   └── MockAdapter.js         # For testing
│   │   │
│   │   ├── mappers/                   # Data transformation layer
│   │   │   ├── BaseMapper.js          # Base mapper interface
│   │   │   ├── PlivoMapper.js         # Plivo data normalization
│   │   │   ├── ExotelMapper.js        # Exotel data normalization
│   │   │   └── TwilioMapper.js        # Twilio data normalization
│   │   │
│   │   ├── validators/                # Input validation
│   │   │   ├── phoneValidator.js      # Phone number validation
│   │   │   └── configValidator.js     # Provider config validation
│   │   │
│   │   └── utils/                     # Utility functions
│   │       ├── webhookSecurity.js     # Webhook signature validation
│   │       ├── costCalculator.js      # Provider cost normalization
│   │       └── retryLogic.js          # Retry failed calls
│   │
│   ├── plivo/                         # EXISTING - Keep unchanged
│   ├── exotel/                        # EXISTING - Keep unchanged
│   └── helper/                        # EXISTING - Keep unchanged
│
├── routes/
│   ├── telephonyRouter.js             # NEW unified telephony routes
│   ├── plivoRouter.js                 # EXISTING - Keep for backward compatibility
│   └── exotelRouter.js                # EXISTING - Keep for backward compatibility
│
└── middleware/
    └── telephonyMiddleware.js         # Provider selection middleware
```

## Core Components

### 1. TelephonyInterface (Base Contract)
```javascript
// src/apps/telephony/TelephonyInterface.js
class TelephonyInterface {
  // Critical functions every provider MUST implement
  
  // Outbound calling
  async makeCall(params) { throw new Error('Not implemented'); }
  async makeCallBulk(contacts, params) { throw new Error('Not implemented'); }
  
  // Call management
  async getCallStatus(callId) { throw new Error('Not implemented'); }
  async endCall(callId) { throw new Error('Not implemented'); }
  async transferCall(callId, targetNumber) { throw new Error('Not implemented'); }
  
  // Recording management
  async getRecording(callId) { throw new Error('Not implemented'); }
  async deleteRecording(callId) { throw new Error('Not implemented'); }
  
  // Webhook normalization
  normalizeRingWebhook(data) { throw new Error('Not implemented'); }
  normalizeAnswerWebhook(data) { throw new Error('Not implemented'); }
  normalizeHangupWebhook(data) { throw new Error('Not implemented'); }
  normalizeDTMFWebhook(data) { throw new Error('Not implemented'); }
  
  // Response formatting for webhooks
  getWebhookResponse(event) { throw new Error('Not implemented'); }
  
  // Provider-specific config validation
  validateConfig(config) { throw new Error('Not implemented'); }
}
```

### 2. Provider Adapters
Each adapter implements the TelephonyInterface with provider-specific logic:

```javascript
// src/apps/telephony/adapters/PlivoAdapter.js
class PlivoAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.authId = config.authId;
    this.authToken = config.authToken;
    this.baseUrl = 'https://api.plivo.com/v1';
  }
  
  async makeCall(params) {
    // Implementation using Plivo API
  }
  
  normalizeRingWebhook(data) {
    return {
      callId: data.CallUUID,
      from: data.From,
      to: data.To,
      direction: data.Direction,
      status: 'ringing',
      timestamp: new Date(),
      raw: data
    };
  }
}
```

### 3. Data Mappers
Transform provider-specific data to normalized schema:

```javascript
// src/apps/telephony/mappers/BaseMapper.js
class BaseMapper {
  static toNormalized(providerData) {
    throw new Error('Must implement toNormalized');
  }
  
  static fromNormalized(normalizedData) {
    throw new Error('Must implement fromNormalized');
  }
}
```

### 4. Normalized Data Schema
```javascript
// Standard schema used across all providers
const NormalizedCallRecord = {
  // Identifiers
  callId: String,           // Unique call identifier
  campaignId: String,       // Campaign reference
  clientId: String,         // Client reference
  provider: String,         // plivo|exotel|twilio
  
  // Call details
  from: String,             // E.164 format
  to: String,               // E.164 format
  direction: String,        // inbound|outbound
  
  // Timing
  startTime: Date,          // ISO 8601
  ringTime: Date,           // When ringing started
  answerTime: Date,         // When call was answered
  endTime: Date,            // When call ended
  duration: Number,         // Total seconds
  billDuration: Number,     // Billable seconds
  
  // Status
  status: String,           // initiated|ringing|answered|completed|failed|busy|no-answer
  hangupCause: String,      // user_hangup|system_hangup|timeout|busy
  hangupSource: String,     // caller|callee|system
  
  // Recording
  recordingUrl: String,     // Recording URL if available
  recordingDuration: Number,// Recording length in seconds
  
  // Cost
  rate: Number,             // Cost per minute
  totalCost: Number,        // Total charge
  currency: String,         // USD|INR|EUR
  
  // Quality metrics
  qualityScore: Number,     // Call quality (0-100)
  issues: Array,            // ['audio_lag', 'disconnection']
  
  // Metadata
  tags: Array,              // Custom tags
  customData: Object,       // Provider-specific data
  
  // Raw data
  raw: Object               // Original provider response
};
```

## Backward Compatibility Strategy

### Phase 1: Parallel Routes (No Breaking Changes)
```javascript
// EXISTING routes continue to work
router.post('/plivo/ring-url', plivoRingHandler);
router.post('/plivo/hangup-url', plivoHangupHandler);

// NEW unified routes run in parallel
router.post('/telephony/webhook/:provider/:event', unifiedWebhookHandler);
```

### Phase 2: Adapter Wrapper for Existing Code
```javascript
// src/apps/telephony/adapters/PlivoAdapter.js
const existingPlivoCode = require('../../plivo/plivo');

class PlivoAdapter extends BaseAdapter {
  async makeCall(params) {
    // Wrap existing function with normalized params
    const plivoParams = this.transformToLegacyFormat(params);
    const result = await existingPlivoCode.makeCallViaCampaign(
      plivoParams.listId,
      plivoParams.fromNumber,
      plivoParams.wssUrl,
      plivoParams.campaignName,
      plivoParams.clientId
    );
    return this.normalizeResponse(result);
  }
}
```

### Phase 3: Database Migration Script
```javascript
// scripts/migrate-telephony-data.js
async function migrateToNormalizedSchema() {
  const collection = db.collection('plivo-call-data');
  const records = await collection.find({}).toArray();
  
  for (const record of records) {
    // Add normalized field without removing existing data
    await collection.updateOne(
      { _id: record._id },
      {
        $set: {
          provider: 'plivo',
          normalized: PlivoMapper.toNormalized(record),
          raw: record,
          migrated: true,
          migrationDate: new Date()
        }
      }
    );
  }
}
```

### Phase 4: Client Configuration Update
```javascript
// Add telephony configuration to client collection
{
  "_id": ObjectId("..."),
  "email": "client@example.com",
  
  // NEW fields (optional, defaults to plivo)
  "telephonyProvider": "plivo", // Default for existing clients
  "telephonyConfig": {
    "authId": process.env.PLIVO_AUTH_ID,
    "authToken": process.env.PLIVO_AUTH_TOKEN,
    "fromNumber": "+1234567890"
  },
  
  // EXISTING fields remain unchanged
  "apiKey": "...",
  "company": "..."
}
```

## Critical Functions by Provider

### Plivo Critical Functions
1. `makeCall()` - Initiate outbound call
2. `getCallStatus()` - Check call progress
3. `endCall()` - Terminate active call
4. `handleRingWebhook()` - Process ring events
5. `handleHangupWebhook()` - Process hangup events
6. `getRecording()` - Retrieve call recording

### Exotel Critical Functions
1. `makeCall()` - Via campaign API
2. `createCampaign()` - Setup calling campaign
3. `getCallDetails()` - Fetch call information
4. `handleCallbackWebhook()` - Process callbacks
5. `uploadContacts()` - CSV upload for campaigns

### Twilio Critical Functions
1. `makeCall()` - Create call via REST API
2. `updateCall()` - Modify in-progress call
3. `fetchCall()` - Get call details
4. `handleStatusCallback()` - Process status updates
5. `fetchRecording()` - Get call recording
6. `validateRequest()` - Webhook signature validation

## Provider Selection Logic
```javascript
// src/apps/telephony/TelephonyManager.js
class TelephonyManager {
  static async getProvider(clientId) {
    // 1. Check client configuration
    const client = await getClientById(clientId);
    
    // 2. Default to plivo for backward compatibility
    const provider = client.telephonyProvider || 'plivo';
    
    // 3. Get configuration
    const config = client.telephonyConfig || {
      authId: process.env[`${provider.toUpperCase()}_AUTH_ID`],
      authToken: process.env[`${provider.toUpperCase()}_AUTH_TOKEN`]
    };
    
    // 4. Return appropriate adapter
    switch(provider) {
      case 'plivo':
        return new PlivoAdapter(config);
      case 'exotel':
        return new ExotelAdapter(config);
      case 'twilio':
        return new TwilioAdapter(config);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
```

## Webhook URL Configuration

### Legacy URLs (Keep Working)
- Plivo: `/plivo/ring-url`, `/plivo/hangup-url`
- Exotel: `/exotel/call-back`, `/exotel/call-back-after-end`

### New Unified URLs
- Pattern: `/telephony/webhook/:provider/:event`
- Examples:
  - `/telephony/webhook/plivo/ring`
  - `/telephony/webhook/twilio/status`
  - `/telephony/webhook/exotel/callback`

### Provider Dashboard Configuration
```
Plivo Dashboard:
- Answer URL: https://api.yourapp.com/telephony/webhook/plivo/answer
- Hangup URL: https://api.yourapp.com/telephony/webhook/plivo/hangup

Twilio Dashboard:
- Webhook URL: https://api.yourapp.com/telephony/webhook/twilio/status
- Status Callback: https://api.yourapp.com/telephony/webhook/twilio/status

Exotel Dashboard:
- Callback URL: https://api.yourapp.com/telephony/webhook/exotel/callback
```

## Error Handling Strategy

```javascript
// src/apps/telephony/errors.js
class TelephonyError extends Error {
  constructor(message, code, provider, originalError) {
    super(message);
    this.code = code;
    this.provider = provider;
    this.originalError = originalError;
    this.timestamp = new Date();
  }
}

class ProviderNotAvailableError extends TelephonyError {}
class InvalidConfigurationError extends TelephonyError {}
class CallFailedError extends TelephonyError {}
class WebhookValidationError extends TelephonyError {}
```

## Migration Timeline

### Week 1: Setup Infrastructure
- Create telephony folder structure
- Implement base interfaces and adapters
- Add PlivoAdapter wrapping existing code

### Week 2: Testing & Validation
- Test PlivoAdapter with existing functionality
- Ensure zero breaking changes
- Add comprehensive logging

### Week 3: Add New Providers
- Implement TwilioAdapter
- Implement ExotelAdapter
- Test provider switching

### Week 4: Migration Tools
- Create data migration scripts
- Build provider comparison dashboard
- Document provider differences

### Week 5: Gradual Rollout
- Migrate test clients to new system
- Monitor performance and errors
- Collect feedback

### Week 6: Full Migration
- Migrate all clients to unified system
- Deprecate legacy endpoints (keep active)
- Update documentation

## Testing Strategy

### Unit Tests
```javascript
// tests/telephony/adapters/PlivoAdapter.test.js
describe('PlivoAdapter', () => {
  it('should normalize ring webhook correctly', () => {
    const plivoData = {
      CallUUID: 'abc123',
      From: '+1234567890',
      To: '+0987654321'
    };
    
    const normalized = adapter.normalizeRingWebhook(plivoData);
    
    expect(normalized.callId).toBe('abc123');
    expect(normalized.from).toBe('+1234567890');
  });
});
```

### Integration Tests
- Test actual API calls with sandbox accounts
- Verify webhook handling
- Test failover scenarios

### Backward Compatibility Tests
- Ensure existing Plivo routes work unchanged
- Verify data migration doesn't break queries
- Test gradual migration scenarios

## Monitoring & Observability

### Metrics to Track
1. Provider success rates
2. Average call duration by provider
3. Cost per minute by provider
4. Webhook processing time
5. Provider API latency

### Logging Strategy
```javascript
// Every adapter method should log
logger.info('Telephony operation', {
  provider: this.name,
  operation: 'makeCall',
  clientId: params.clientId,
  duration: endTime - startTime,
  success: true,
  cost: calculatedCost
});
```

## Security Considerations

1. **Webhook Validation**: Each provider has different signature validation
2. **Rate Limiting**: Provider-specific rate limits must be respected
3. **Credential Storage**: Use environment variables or secure vault
4. **IP Whitelisting**: Some providers support webhook IP restrictions
5. **Audit Logging**: Track all telephony operations for compliance

## Performance Optimizations

1. **Connection Pooling**: Reuse HTTP connections per provider
2. **Caching**: Cache provider configurations (5-minute TTL)
3. **Batch Operations**: Use bulk APIs where available
4. **Async Processing**: Non-blocking webhook processing
5. **Circuit Breaker**: Automatic failover on provider issues

## Provider Feature Matrix

| Feature | Plivo | Exotel | Twilio |
|---------|-------|---------|---------|
| Outbound Calls | ✅ | ✅ | ✅ |
| Inbound Calls | ✅ | ✅ | ✅ |
| Call Recording | ✅ | ✅ | ✅ |
| DTMF Detection | ✅ | ✅ | ✅ |
| Call Transfer | ✅ | ⚠️ | ✅ |
| Conference Calls | ✅ | ⚠️ | ✅ |
| Webhook Security | HMAC | Basic Auth | HMAC |
| Bulk Calling | ✅ | ✅ | ⚠️ |
| Real-time Events | WebSocket | Polling | WebSocket |
| Cost | $$ | $ | $$$ |

Legend: ✅ Full Support, ⚠️ Limited Support, ❌ Not Available

## Configuration Examples

### Environment Variables
```bash
# Provider Selection (per client in DB)
DEFAULT_TELEPHONY_PROVIDER=plivo

# Plivo Configuration
PLIVO_AUTH_ID=your_auth_id
PLIVO_AUTH_TOKEN=your_auth_token
PLIVO_DEFAULT_FROM=+1234567890

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_DEFAULT_FROM=+1234567890

# Exotel Configuration
EXOTEL_ACCOUNT_SID=your_account_sid
EXOTEL_API_KEY=your_api_key
EXOTEL_API_TOKEN=your_api_token
```

## Rollback Strategy

If issues arise during migration:

1. **Feature Flag**: Toggle to disable new telephony system
2. **Dual Writing**: Write to both old and new systems
3. **Quick Revert**: Legacy routes remain active
4. **Data Sync**: Automated sync between old and new schemas
5. **Provider Fallback**: Automatic fallback to Plivo if new provider fails

## Success Criteria

1. ✅ Zero downtime during migration
2. ✅ No breaking changes for existing clients
3. ✅ Frontend continues working without modifications
4. ✅ All existing Plivo features remain functional
5. ✅ New providers can be added in < 1 day
6. ✅ Performance remains same or better
7. ✅ Cost optimization through provider selection
8. ✅ Improved monitoring and debugging capabilities

## Next Steps

1. Review and approve architecture
2. Create implementation tickets
3. Set up test environments for each provider
4. Begin Phase 1 implementation
5. Schedule weekly migration review meetings