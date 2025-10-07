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
      const response = await makeInternalAPIRequest(`/api/tools/wati/bot/${this.agentId}`, {
        method: 'GET'
      });

      if (!response.success) {
        console.error('❌ WATI MCP: Bot endpoint failed:', response.message);
        return;
      }

      if (!response.wati_tools || response.wati_tools.length === 0) {
        console.warn('⚠️ WATI MCP: No tools assigned to agent');
        return;
      }

      console.log(`✅ WATI MCP: Loaded ${response.wati_tools.length} tool(s) for agent ${this.agentId}`);
      this.toolConfigs = response.wati_tools;

      // Clear existing tools
      this.tools.clear();
      if (this.toolHandlers) {
        this.toolHandlers.clear();
      }

      // Create a tool for each assigned tool configuration
      for (const toolConfig of this.toolConfigs) {

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

        this.registerTool(
          toolName,
          description,
          inputSchema,
          this.sendTemplateMessageDynamic.bind(this, toolConfig)
        );
      }

      console.log(`✅ WATI MCP: Registered ${this.tools.size} tool(s)`);
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
      const credentials = await TelephonyCredentialsService.getCredentials(this.clientId, 'wati');

      if (!credentials.accessToken && !credentials.wati_api_key) {
        throw new Error('WATI API key not found in credentials');
      }

      let apiKey = credentials.accessToken || credentials.wati_api_key;

      // Extract tenant ID from JWT token for base URL
      let tenantId = '';
      try {
        const cleanToken = apiKey.startsWith('Bearer ') ? apiKey.substring(7) : apiKey;
        const tokenPayload = JSON.parse(Buffer.from(cleanToken.split('.')[1], 'base64').toString());
        tenantId = tokenPayload.tenant_id;
      } catch (e) {
        console.warn('⚠️ WATI MCP: Could not extract tenant ID from token');
      }

      // Build WATI API URL with tenant ID
      const baseUrl = tenantId
        ? `https://live-mt-server.wati.io/${tenantId}/api/v1`
        : 'https://live-mt-server.wati.io/api/v1';

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

      console.log(`📱 WATI → Sending template "${templateName}" to ${formattedRecipient}`);

      // Send via WATI API using correct endpoint with query parameter
      const url = `${baseUrl}/sendTemplateMessage?whatsappNumber=${formattedRecipient}`;
      const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ WATI → Message sent successfully (ID: ${response.data.id || 'unknown'})`);

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

    // Setup dynamic tools based on agent assignments
    await this.setupDynamicTools();
  }

  async handleHttpRequest(mcpRequest) {
    try {

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
          // JSON-RPC notifications don't expect a response
          if (mcpRequest.id === null || mcpRequest.id === undefined) {
            return undefined;
          }
          return {
            jsonrpc: '2.0',
            id: mcpRequest.id,
            result: null
          };

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