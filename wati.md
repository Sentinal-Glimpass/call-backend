# WATI Tool Creation Guide

This guide explains how users can create custom WATI WhatsApp tools using the existing API infrastructure.

## Overview

Users can create custom WATI tools by:
1. Selecting an available WhatsApp template from their WATI account
2. Defining which template variables should be AI-generated
3. Creating OpenAI function schema
4. Registering the tool in the system

## Step-by-Step Process

### Step 1: Setup WATI Credentials (Prerequisites)

First, ensure WATI credentials are configured:

```bash
# Add WATI credentials for your client
POST /telephony-credentials/add
{
  "clientId": "your_client_id",
  "provider": "wati",
  "accessToken": "your_wati_access_token",
  "apiEndpoint": "https://your-wati-domain.wati.io/api/v1", // Optional: your specific API endpoint
  "metadata": {
    "region": "global",
    "billing_enabled": true
  }
}
```

**Note**: You only need the `accessToken` from your WATI dashboard. The `apiEndpoint` is optional - if you have a custom WATI domain/endpoint from your dashboard, include it. Otherwise, the system will use the default WATI API endpoint.

### Step 2: Fetch Available Templates

Get available WhatsApp templates from your WATI account:

```bash
# This endpoint would need to be created - see implementation below
GET /api/tools/wati/templates?clientId=your_client_id
```

**Response Example:**
```json
{
  "success": true,
  "templates": [
    {
      "name": "welcome_message",
      "category": "MARKETING",
      "language": "en",
      "status": "APPROVED",
      "components": [
        {
          "type": "BODY",
          "text": "Hello {{1}}, welcome to {{2}}! Your appointment is scheduled for {{3}}."
        },
        {
          "type": "FOOTER",
          "text": "Reply STOP to unsubscribe"
        }
      ],
      "variables": [
        {
          "position": "{{1}}",
          "description": "Customer name",
          "required": true
        },
        {
          "position": "{{2}}",
          "description": "Business name",
          "required": true
        },
        {
          "position": "{{3}}",
          "description": "Appointment date/time",
          "required": true
        }
      ]
    }
  ]
}
```

### Step 3: Create Custom WATI Tool

Define your custom tool by selecting template and AI-generated variables:

```bash
POST /api/tools/registry
{
  "name": "wati_welcome_appointment",
  "description": "Send personalized welcome message with appointment details via WhatsApp",
  "version": "1.0.0",
  "openai_schema": {
    "type": "function",
    "function": {
      "name": "send_welcome_appointment",
      "description": "Send a welcome WhatsApp message with personalized appointment details",
      "parameters": {
        "type": "object",
        "properties": {
          "phone_number": {
            "type": "string",
            "description": "Customer's WhatsApp number (with country code)"
          },
          "customer_name": {
            "type": "string", 
            "description": "Customer's full name for personalization"
          },
          "appointment_datetime": {
            "type": "string",
            "description": "Appointment date and time in friendly format (e.g. 'Monday, Dec 25th at 3:00 PM')"
          }
        },
        "required": ["phone_number", "customer_name", "appointment_datetime"]
      }
    }
  },
  "endpoint_config": {
    "method": "POST",
    "base_url": "https://live-mt-server.wati.io",
    "path": "/{{instanceId}}/api/v1/sendTemplateMessage",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer {{accessToken}}"
    },
    "auth_type": "bearer",
    "template_config": {
      "template_name": "welcome_message",
      "variable_mapping": {
        "{{1}}": "customer_name",
        "{{2}}": "business_name",
        "{{3}}": "appointment_datetime"
      },
      "static_variables": {
        "business_name": "Your Business Name"
      }
    }
  },
  "auth_requirements": ["accessToken", "instanceId"],
  "rate_limits": {
    "default": { "requests": 100, "period": "hour" }
  }
}
```

### Step 4: Create Client Tool Configuration

Configure the tool for your specific use case:

```bash
POST /api/tools/configs
{
  "config_name": "welcome_appointment_urgent",
  "tool_name": "wati_welcome_appointment", 
  "enabled": true,
  "strategy": "immediate",
  "parameters": {
    "business_name": "Acme Healthcare",
    "default_message_type": "appointment_confirmation"
  },
  "conditions": ["appointment_scheduled"],
  "assigned_campaigns": ["healthcare_followup"]
}
```

### Step 5: Get OpenAI Function Schemas for Bot

Retrieve the function schemas that your bot will use:

```bash
GET /api/tools/schemas?campaign_id=healthcare_followup
```

**Response:**
```json
{
  "status": 200,
  "schemas": [
    {
      "type": "function",
      "function": {
        "name": "wati_welcome_appointment_welcome_appointment_urgent",
        "description": "Send a welcome WhatsApp message with personalized appointment details (Config: welcome_appointment_urgent)",
        "parameters": {
          "type": "object",
          "properties": {
            "phone_number": {
              "type": "string",
              "description": "Customer's WhatsApp number (with country code)"
            },
            "customer_name": {
              "type": "string",
              "description": "Customer's full name for personalization"
            },
            "appointment_datetime": {
              "type": "string", 
              "description": "Appointment date and time in friendly format"
            }
          },
          "required": ["phone_number", "customer_name", "appointment_datetime"]
        }
      },
      "config_id": "config_id_here",
      "tool_name": "wati_welcome_appointment",
      "strategy": "immediate"
    }
  ]
}
```

### Step 6: Execute Tool from Bot

When your AI bot decides to send a WhatsApp message:

```bash
POST /api/tools/execute
{
  "function_name": "wati_welcome_appointment_welcome_appointment_urgent",
  "arguments": {
    "phone_number": "+919876543210",
    "customer_name": "John Doe",
    "appointment_datetime": "Monday, Dec 25th at 3:00 PM"
  },
  "context": {
    "campaign_id": "healthcare_followup",
    "call_id": "call_12345"
  }
}
```

**Response:**
```json
{
  "status": 200,
  "message": "Tool executed successfully",
  "result": {
    "status_code": 200,
    "data": {
      "message": "Message sent successfully",
      "messageId": "wati_msg_123456",
      "status": "sent"
    }
  },
  "execution_time_ms": 1250,
  "config_used": {
    "config_id": "config_id_here",
    "config_name": "welcome_appointment_urgent",
    "tool_name": "wati_welcome_appointment"
  }
}
```

## Advanced Configuration Examples

### Multi-Language Support

```json
{
  "name": "wati_welcome_multilang",
  "endpoint_config": {
    "template_config": {
      "template_selection": "dynamic",
      "language_mapping": {
        "en": "welcome_message_en",
        "es": "welcome_message_es",
        "hi": "welcome_message_hi"
      }
    }
  },
  "openai_schema": {
    "function": {
      "parameters": {
        "properties": {
          "language": {
            "type": "string",
            "enum": ["en", "es", "hi"],
            "description": "Language for the message"
          }
        }
      }
    }
  }
}
```

### Conditional Template Selection

```json
{
  "name": "wati_smart_reminder",
  "endpoint_config": {
    "template_config": {
      "conditional_templates": {
        "first_reminder": "gentle_reminder",
        "second_reminder": "urgent_reminder", 
        "final_reminder": "last_chance_reminder"
      }
    }
  },
  "openai_schema": {
    "function": {
      "parameters": {
        "properties": {
          "reminder_type": {
            "type": "string",
            "enum": ["first_reminder", "second_reminder", "final_reminder"],
            "description": "Type of reminder to send"
          }
        }
      }
    }
  }
}
```

### Media Templates

```json
{
  "name": "wati_media_promotion",
  "endpoint_config": {
    "template_config": {
      "template_name": "promotion_with_image",
      "media_support": true,
      "variable_mapping": {
        "{{1}}": "customer_name",
        "{{2}}": "offer_details"
      }
    }
  },
  "openai_schema": {
    "function": {
      "parameters": {
        "properties": {
          "media_url": {
            "type": "string",
            "description": "URL of the promotional image/video"
          }
        }
      }
    }
  }
}
```

## Required API Endpoints to Implement

To fully support this workflow, these additional endpoints should be created:

### 1. Template Fetching Endpoint

```javascript
// GET /api/tools/wati/templates
router.get('/wati/templates', async (req, res) => {
  try {
    const { clientId } = req.query;
    
    // Get WATI credentials
    const credentials = await TelephonyCredentialsService.getCredentials(clientId, 'wati');
    
    // Fetch templates from WATI API
    const response = await axios.get(
      `https://live-mt-server.wati.io/${credentials.instanceId}/api/v1/getMessageTemplates`,
      {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Transform templates for frontend consumption
    const templates = response.data.messageTemplates.map(template => ({
      name: template.name,
      category: template.category,
      language: template.language,
      status: template.status,
      components: template.components,
      variables: extractVariables(template.components)
    }));
    
    res.json({
      success: true,
      templates: templates,
      count: templates.length
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch WATI templates'
    });
  }
});
```

### 2. Enhanced Tool Execution with Template Processing

The existing `executeToolFunction` in `tools.js` should be enhanced to handle WATI-specific template processing:

```javascript
// In buildApiRequest function, add WATI template handling
if (tool.name.startsWith('wati_') && tool.endpoint_config.template_config) {
  const templateConfig = tool.endpoint_config.template_config;
  
  // Build WATI template message payload
  const templatePayload = {
    template_name: templateConfig.template_name,
    broadcast_name: `broadcast_${Date.now()}`,
    receivers: [{
      whatsappNumber: functionArgs.phone_number,
      customParams: []
    }]
  };
  
  // Map function arguments to template variables
  for (const [templateVar, argName] of Object.entries(templateConfig.variable_mapping)) {
    if (functionArgs[argName]) {
      templatePayload.receivers[0].customParams.push({
        name: templateVar.replace(/[{}]/g, ''), // Remove {{}}
        value: functionArgs[argName]
      });
    }
  }
  
  // Add static variables
  if (templateConfig.static_variables) {
    for (const [templateVar, value] of Object.entries(templateConfig.static_variables)) {
      templatePayload.receivers[0].customParams.push({
        name: templateVar,
        value: value
      });
    }
  }
  
  requestData = templatePayload;
}
```

## Usage Flow Summary

1. **User adds WATI credentials** → `/telephony-credentials/add`  
2. **User fetches available templates** → `/api/tools/wati/templates`
3. **User creates custom tool definition** → `/api/tools/registry`
4. **User configures tool for their use case** → `/api/tools/configs`
5. **Bot fetches function schemas** → `/api/tools/schemas`
6. **Bot executes tool when needed** → `/api/tools/execute`

This approach allows complete customization of WATI WhatsApp messaging while leveraging the existing credential management and tool orchestration infrastructure.