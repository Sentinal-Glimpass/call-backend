# Phone Number Management Scripts

## addNumber.js - Add Phone Numbers to Providers

Quick CLI tool to map phone numbers to telephony providers (Plivo/Twilio).

### Usage

```bash
# Add number with Twilio (default for this script)
node scripts/addNumber.js +18787876789

# Add number with specific provider  
node scripts/addNumber.js +18787876789 twilio
node scripts/addNumber.js +18787876789 plivo

# Show help
node scripts/addNumber.js --help
```

### Examples

```bash
# US numbers with Twilio
node scripts/addNumber.js +14155552222
node scripts/addNumber.js +12125551234

# Indian numbers with Plivo  
node scripts/addNumber.js +918035735659 plivo
node scripts/addNumber.js +919876543210 plivo

# Update existing number
node scripts/addNumber.js +18787876789 plivo  # Will prompt to update from twilio to plivo
```

### Features

- ✅ **Smart Defaults**: Defaults to Twilio (perfect for quick US number setup)
- ✅ **Interactive Updates**: Prompts before overwriting existing mappings
- ✅ **Validation**: Checks phone number format and provider validity
- ✅ **Verification**: Confirms mapping after creation
- ✅ **Colored Output**: Easy-to-read terminal output
- ✅ **Error Handling**: Comprehensive error messages

### What It Does

1. **Validates** phone number format (+1234567890)
2. **Checks** if number already exists in database
3. **Prompts** for confirmation if updating existing mapping
4. **Creates/Updates** mapping in MongoDB `phoneProviders` collection
5. **Verifies** the mapping was created successfully
6. **Shows** next steps and test commands

### Testing Your Numbers

After adding numbers, test the routing:

```bash
# Test individual numbers
curl "http://localhost:7999/phone-provider/test/+18787876789"
curl "http://localhost:7999/phone-provider/test/+14155552222"

# Test call routing simulation
curl -X POST "http://localhost:7999/phone-provider/test-call" \
  -H "Content-Type: application/json" \
  -d '{"from": "+18787876789", "to": "+919608848421", "wssUrl": "wss://test.com/chat/v2/uuid", "clientId": "test"}'
```

### Current Behavior

- **System Default**: Unmapped numbers → Plivo  
- **Script Default**: `addNumber.js` → Twilio
- **Explicit Control**: Specify provider as second argument

This makes it easy to:
- Keep existing Plivo numbers working (system default)  
- Quickly add new Twilio numbers for testing
- Have full control when needed