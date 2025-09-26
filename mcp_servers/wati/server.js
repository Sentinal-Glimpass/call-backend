#!/usr/bin/env node
const { BaseMCPServer } = require('../shared/base-server.js');
const {
  makeInternalAPIRequest,
  validateTemplateVariables,
  validatePhoneNumber,
  formatMCPResponse,
  createMCPSchema,
} = require('../shared/utils.js');
const TelephonyCredentialsService = require('../../src/services/telephonyCredentialsService');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ path: '../../.env' });

class WATIMCPServer extends BaseMCPServer {
  constructor() {
    super('wati-mcp-server', '1.0.0');
    this.agentId = null;
    this.clientId = null;
    this.toolConfigs = [];
  }

  async setupDynamicTools() {
    if (!this.agentId || !this.clientId) {
      console.error('⚠️ Cannot setup tools without agent and client context');
      return;
    }

    try {
      // Get agent's WATI tool assignments and configurations
      console.log(`🔍 Fetching WATI tools for agent: ${this.agentId}`);
      const response = await makeInternalAPIRequest(`/api/tools/wati/bot/${this.agentId}`, {
        method: 'GET'
      });

      console.log(`📊 Bot endpoint response:`, JSON.stringify(response, null, 2));

      if (!response.success) {
        console.error('❌ Bot endpoint returned success=false:', response);
        return;
      }

      if (!response.wati_tools) {
        console.error('❌ No wati_tools field in response:', Object.keys(response));
        return;
      }

      if (response.wati_tools.length === 0) {
        console.error('⚠️ wati_tools array is empty');
        return;
      }

      console.log(`✅ Found ${response.wati_tools.length} WATI tools for agent`);
      this.toolConfigs = response.wati_tools;

      // Clear existing tools
      this.tools.clear();
      if (this.toolHandlers) {
        this.toolHandlers.clear();
      }

      // Create a tool for each assigned tool configuration
      console.log(`🔧 Starting tool registration for ${this.toolConfigs.length} tools`);
      for (const toolConfig of this.toolConfigs) {
        console.log(`📝 Processing tool config:`, JSON.stringify(toolConfig, null, 2));

        const toolName = 'whatsapp_messenger';
        const description = 'Send a whatsapp message to the user';

        // Get template details to build schema
        let inputSchema = {
          type: 'object',
          properties: {
            recipient: {
              type: 'string',
              description: 'WhatsApp phone number with country code (e.g., +919876543210)'
            }
          },
          required: ['recipient']
        };

        // For now, use basic schema with just recipient
        // Template variables can be added later when we have them in the tool config
        console.log(`📋 Using basic schema for tool: ${toolConfig.tool_name}`);

        console.log(`📋 Final input schema:`, JSON.stringify(inputSchema, null, 2));

        this.registerTool(
          toolName,
          description,
          inputSchema,
          this.sendTemplateMessageDynamic.bind(this, toolConfig)
        );

        console.log(`✅ Successfully registered dynamic WATI tool: ${toolName} for tool_id: ${toolConfig.wati_tool_id}`);
      }

      console.log(`🎯 Total tools registered: ${this.tools.size}`);
      console.log(`🎯 Tool names:`, Array.from(this.tools.keys()));
    } catch (error) {
      console.error('❌ Error setting up dynamic WATI tools:', error);
    }
  }

  async sendTemplateMessageDynamic(toolConfig, args) {
    try {
      this.validateArgs(args, ['recipient']);

      const { recipient } = args;

      // Validate phone number
      validatePhoneNumber(recipient);

      // Get WATI credentials for the client using direct database access
      console.log(`🔍 Getting WATI credentials for client: ${this.clientId}`);
      const credentials = await TelephonyCredentialsService.getCredentials(this.clientId, 'wati');

      if (!credentials.accessToken && !credentials.wati_api_key) {
        throw new Error('WATI API key not found in credentials');
      }

      let apiKey = credentials.accessToken || credentials.wati_api_key;

      console.log(`🔑 API Key found: ${apiKey ? 'YES' : 'NO'}`);
      console.log(`🔑 API Key preview: ${apiKey ? apiKey.substring(0, 20) + '...' : 'NONE'}`);

      // Extract tenant ID from JWT token for base URL
      let tenantId = '';
      try {
        // Clean token for JWT parsing (remove Bearer prefix if present)
        const cleanToken = apiKey.startsWith('Bearer ') ? apiKey.substring(7) : apiKey;
        console.log(`🎫 Clean token preview: ${cleanToken.substring(0, 20)}...`);
        const tokenPayload = JSON.parse(Buffer.from(cleanToken.split('.')[1], 'base64').toString());
        tenantId = tokenPayload.tenant_id;
        console.log(`🏢 Extracted tenant ID: ${tenantId}`);
      } catch (e) {
        console.log('❌ Could not extract tenant ID from token:', e.message);
        console.log('🔄 Using default URL');
      }

      // Build WATI API URL with tenant ID
      const baseUrl = tenantId
        ? `https://live-mt-server.wati.io/${tenantId}/api/v1`
        : 'https://live-mt-server.wati.io/api/v1';

      console.log(`🌐 WATI API Base URL: ${baseUrl}`);

      // Format recipient (digits only, with country code)
      let formattedRecipient = recipient.replace(/\D/g, '');
      if (!formattedRecipient.startsWith('91') && formattedRecipient.length === 10) {
        formattedRecipient = '91' + formattedRecipient; // Default to India
      }

      // Extract template variables from args (everything except recipient)
      const variables = { ...args };
      delete variables.recipient;

      // Get template name from tool configuration (now required)
      const templateName = toolConfig.template_name;
      if (!templateName) {
        throw new Error(`Template name not found for tool configuration: ${toolConfig.wati_tool_id}`);
      }

      // Prepare parameters array for WATI API
      const parameters = Object.entries(variables).map(([name, value]) => ({
        name,
        value: String(value)
      }));

      // Prepare request payload (correct WATI format)
      const payload = {
        template_name: templateName,
        broadcast_name: `mcp_${toolConfig.wati_tool_id}_${Date.now()}`,
        parameters
      };

      console.error(`📱 Sending WATI message to ${formattedRecipient} using template: ${templateName}`);
      console.error(`📦 Payload:`, JSON.stringify(payload, null, 2));

      // Send via WATI API using correct endpoint with query parameter
      const url = `${baseUrl}/sendTemplateMessage?whatsappNumber=${formattedRecipient}`;

      const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;

      console.log(`🚀 Final API call:`);
      console.log(`   URL: ${url}`);
      console.log(`   Auth: ${authHeader.substring(0, 20)}...`);
      console.log(`   Payload:`, JSON.stringify(payload, null, 2));

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ WATI API response:`, response.data);

      return formatMCPResponse(true, {
        message_id: response.data.id || 'sent',
        recipient: formattedRecipient,
        tool_name: toolConfig.tool_name,
        template_name: templateName,
        parameters,
        wati_response: response.data
      }, `WhatsApp message sent successfully using ${toolConfig.tool_name}`);

    } catch (error) {
      console.error('❌ Error sending WATI template message:', error);
      return formatMCPResponse(false, null, 'Failed to send WhatsApp message', error.message);
    }
  }

  // Legacy method - keeping for backward compatibility but not used in dynamic mode
  async sendTemplateMessage(args) {
    try {
      this.validateArgs(args, ['client_id', 'recipient', 'template_name']);

      const { client_id, recipient, template_name, language = 'en', variables = {} } = args;

      // Validate phone number
      validatePhoneNumber(recipient);

      // Get WATI credentials
      const credentials = await getClientCredentials(client_id, 'wati');

      if (!credentials.wati_api_key) {
        throw new Error('WATI API key not found in credentials');
      }

      // Build WATI API URL
      const baseUrl = credentials.wati_instance_id
        ? `https://live-mt-server.wati.io/${credentials.wati_instance_id}/api/v1`
        : 'https://live-mt-server.wati.io/api/v1';

      // Format recipient (ensure it starts with country code)
      let formattedRecipient = recipient.replace(/\D/g, '');
      if (!formattedRecipient.startsWith('91') && formattedRecipient.length === 10) {
        formattedRecipient = '91' + formattedRecipient; // Default to India
      }

      // Prepare template message payload
      const payload = {
        template_name,
        broadcast_name: `mcp_${template_name}_${Date.now()}`,
        receivers: [
          {
            whatsappNumber: formattedRecipient,
            customParams: Object.entries(variables).map(([key, value]) => ({
              name: key,
              value: String(value)
            }))
          }
        ]
      };

      console.error(`Sending WATI template message to ${formattedRecipient} using template ${template_name}`);

      // Send via WATI API
      const response = await axios.post(`${baseUrl}/sendTemplateMessage`, payload, {
        headers: {
          'Authorization': `Bearer ${credentials.wati_api_key}`,
          'Content-Type': 'application/json'
        }
      });

      return formatMCPResponse(true, {
        message_id: response.data.id || 'sent',
        recipient: formattedRecipient,
        template_name,
        variables,
        wati_response: response.data
      }, 'WhatsApp template message sent successfully');

    } catch (error) {
      console.error('Error sending WATI template message:', error);
      return formatMCPResponse(false, null, 'Failed to send WhatsApp message', error.message);
    }
  }

  async sendTextMessage(args) {
    try {
      this.validateArgs(args, ['client_id', 'recipient', 'message']);

      const { client_id, recipient, message } = args;

      // Validate phone number
      validatePhoneNumber(recipient);

      // Get WATI credentials
      const credentials = await getClientCredentials(client_id, 'wati');

      if (!credentials.wati_api_key) {
        throw new Error('WATI API key not found in credentials');
      }

      // Build WATI API URL
      const baseUrl = credentials.wati_instance_id
        ? `https://live-mt-server.wati.io/${credentials.wati_instance_id}/api/v1`
        : 'https://live-mt-server.wati.io/api/v1';

      // Format recipient
      let formattedRecipient = recipient.replace(/\D/g, '');
      if (!formattedRecipient.startsWith('91') && formattedRecipient.length === 10) {
        formattedRecipient = '91' + formattedRecipient;
      }

      // Prepare text message payload
      const payload = {
        phone: formattedRecipient,
        message,
        message_type: 'text'
      };

      console.error(`Sending WATI text message to ${formattedRecipient}`);

      // Send via WATI API
      const response = await axios.post(`${baseUrl}/sendMessage`, payload, {
        headers: {
          'Authorization': `Bearer ${credentials.wati_api_key}`,
          'Content-Type': 'application/json'
        }
      });

      return formatMCPResponse(true, {
        message_id: response.data.id || 'sent',
        recipient: formattedRecipient,
        message,
        wati_response: response.data
      }, 'WhatsApp text message sent successfully');

    } catch (error) {
      console.error('Error sending WATI text message:', error);
      return formatMCPResponse(false, null, 'Failed to send WhatsApp text message', error.message);
    }
  }

  async getTemplates(args) {
    try {
      this.validateArgs(args, ['client_id']);

      const { client_id, language = null, status = null } = args;

      // Use internal API to get templates
      const filters = {};
      if (language) filters.language = language;
      if (status) filters.status = status;

      const response = await makeInternalAPIRequest('/api/tools/wati/templates', {
        method: 'GET',
        params: { ...filters, client_id }
      });

      return formatMCPResponse(true, {
        templates: response.templates || [],
        count: response.count || 0,
        filters: filters
      }, 'WATI templates retrieved successfully');

    } catch (error) {
      console.error('Error getting WATI templates:', error);
      return formatMCPResponse(false, null, 'Failed to get WATI templates', error.message);
    }
  }

  // HTTP handling methods for cross-server communication
  async setAgentContext(agentId, clientId) {
    this.agentId = agentId;
    this.clientId = clientId;
    console.log(`🔌 WATI MCP Server context set: agentId=${agentId}, clientId=${clientId}`);

    // Setup dynamic tools based on agent assignments
    await this.setupDynamicTools();
  }

  async handleHttpRequest(mcpRequest) {
    try {
      console.log('🔌 Processing WATI MCP HTTP request:', JSON.stringify(mcpRequest, null, 2));

      // Handle potential parsing issues
      if (!mcpRequest || typeof mcpRequest !== 'object') {
        console.error('❌ WATI MCP: Invalid request - not an object');
        return {
          jsonrpc: '2.0',
          id: 0,
          error: {
            code: -32700,
            message: 'Parse error - invalid request object'
          }
        };
      }

      // Validate JSON-RPC 2.0 format with more detailed logging
      if (!mcpRequest.jsonrpc) {
        console.error('❌ WATI MCP: Missing jsonrpc field');
        console.error('❌ Available fields:', Object.keys(mcpRequest));
        return {
          jsonrpc: '2.0',
          id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
          error: {
            code: -32600,
            message: 'Invalid Request - missing jsonrpc field'
          }
        };
      }

      if (mcpRequest.jsonrpc !== '2.0') {
        console.error('❌ WATI MCP: Invalid jsonrpc version:', mcpRequest.jsonrpc);
        return {
          jsonrpc: '2.0',
          id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
          error: {
            code: -32600,
            message: `Invalid Request - jsonrpc must be "2.0", got "${mcpRequest.jsonrpc}"`
          }
        };
      }

      // Route to appropriate handler based on MCP method
      let result;
      switch (mcpRequest.method) {
        case 'initialize':
          result = await this.handleInitialize(mcpRequest.params || {});
          break;

        case 'notifications/initialized':
          // Handle initialized notification (no response needed for notifications)
          console.log('🔌 WATI MCP Server received initialized notification');
          // JSON-RPC notifications don't expect a response - check if this is a notification
          if (mcpRequest.id === null || mcpRequest.id === undefined) {
            // This is a notification, don't send any response
            return undefined;
          } else {
            // This shouldn't happen for notifications, but handle it gracefully
            return {
              jsonrpc: '2.0',
              id: mcpRequest.id,
              result: null
            };
          }

        case 'tools/list':
          result = await this.handleToolsList();
          break;

        case 'tools/call':
          if (!mcpRequest.params || !mcpRequest.params.name) {
            return {
              jsonrpc: '2.0',
              id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
              error: {
                code: -32602,
                message: 'Invalid params - tool name is required'
              }
            };
          }
          result = await this.handleToolCall(mcpRequest.params.name, mcpRequest.params.arguments || {});
          break;

        default:
          return {
            jsonrpc: '2.0',
            id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
            error: {
              code: -32601,
              message: `Method not found: ${mcpRequest.method}`
            }
          };
      }

      // Return successful JSON-RPC 2.0 response
      return {
        jsonrpc: '2.0',
        id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
        result: result
      };

    } catch (error) {
      console.error('❌ WATI MCP HTTP request error:', error);
      return {
        jsonrpc: '2.0',
        id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        }
      };
    }
  }

  async handleInitialize(params) {
    console.log('🔌 WATI MCP Server initialize called with params:', params);

    // Return MCP initialization response
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'wati-mcp-server',
        version: '1.0.0'
      }
    };
  }

  async handleToolsList() {
    // Return dynamically registered tools
    return {
      tools: Array.from(this.tools.values())
    };
  }

  async handleToolCall(toolName, args) {
    // Use the dynamic tool execution from BaseMCPServer
    const result = await this.executeTool(toolName, args);

    // Return MCP tool call response format
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
}

// Start the server
async function main() {
  const server = new WATIMCPServer();
  await server.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

module.exports = { WATIMCPServer };