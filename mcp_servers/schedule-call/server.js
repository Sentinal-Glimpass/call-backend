#!/usr/bin/env node
const { BaseMCPServer } = require('../shared/base-server.js');
const {
  makeInternalAPIRequest,
  validatePhoneNumber,
  formatMCPResponse,
} = require('../shared/utils.js');
const dotenv = require('dotenv');

dotenv.config({ path: '../../.env' });

class ScheduleCallMCPServer extends BaseMCPServer {
  constructor() {
    super('schedule-call-mcp-server', '1.0.0');
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
      const response = await makeInternalAPIRequest(`/api/tools/schedule-call/bot/${this.agentId}`, {
        method: 'GET'
      });

      if (!response.success) {
        console.error('❌ Schedule Call MCP: Bot endpoint failed:', response.message);
        return;
      }

      if (!response.schedule_call_tools || response.schedule_call_tools.length === 0) {
        console.warn('⚠️ Schedule Call MCP: No tools assigned to agent');
        return;
      }

      console.log(`✅ Schedule Call MCP: Loaded ${response.schedule_call_tools.length} tool(s) for agent ${this.agentId}`);
      this.toolConfigs = response.schedule_call_tools;

      // Clear existing tools
      this.tools.clear();
      if (this.toolHandlers) {
        this.toolHandlers.clear();
      }

      for (const toolConfig of this.toolConfigs) {
        const toolName = 'schedule_followup_call';
        const description = toolConfig.description || 'Schedule a follow-up call to a phone number after a delay';

        const inputSchema = {
          type: 'object',
          properties: {
            phone_number: {
              type: 'string',
              description: 'Phone number to call with country code (e.g., +919876543210)'
            },
            delay: {
              type: 'string',
              description: `Delay before the call is made (e.g., "24h", "2h", "30m", "1d"). Default: ${toolConfig.default_delay || '24h'}`
            },
            context: {
              type: 'string',
              description: 'Context or notes to pass to the follow-up call agent (e.g., what was discussed, what to follow up on)'
            }
          },
          required: ['phone_number']
        };

        this.registerTool(
          toolName,
          description,
          inputSchema,
          this.scheduleCall.bind(this, toolConfig)
        );
      }

      console.log(`✅ Schedule Call MCP: Registered ${this.tools.size} tool(s)`);
    } catch (error) {
      console.error('❌ Error setting up dynamic schedule call tools:', error);
    }
  }

  async scheduleCall(toolConfig, args) {
    try {
      this.validateArgs(args, ['phone_number']);

      const { phone_number, delay, context } = args;

      validatePhoneNumber(phone_number);

      const callDelay = delay || toolConfig.default_delay || '24h';

      // Use the schedule call service via internal API
      const response = await makeInternalAPIRequest('/api/tools/schedule-call/create-scheduled', {
        method: 'POST',
        data: {
          clientId: this.clientId,
          targetAgentId: toolConfig.target_agent_id,
          fromNumber: toolConfig.from_number,
          toNumber: phone_number,
          delay: callDelay,
          context: context || '',
          scheduledByAgentId: this.agentId,
          scheduledByCallUUID: args.call_uuid || null
        }
      });

      if (!response.success) {
        throw new Error(response.message || 'Failed to schedule call');
      }

      console.log(`📞 Schedule Call → Scheduled call to ${phone_number} in ${callDelay}`);

      return formatMCPResponse(true, {
        scheduled_call_id: response.data?._id,
        phone_number,
        delay: callDelay,
        execute_at: response.data?.executeAt,
        target_agent: toolConfig.target_agent_id,
        context: context || ''
      }, `Follow-up call scheduled successfully. Will call ${phone_number} in ${callDelay}.`);

    } catch (error) {
      console.error('❌ Error scheduling call:', error);
      return formatMCPResponse(false, null, 'Failed to schedule follow-up call', error.message);
    }
  }

  async setAgentContext(agentId, clientId) {
    this.agentId = agentId;
    this.clientId = clientId;
    await this.setupDynamicTools();
  }

  async handleHttpRequest(mcpRequest) {
    try {
      if (!mcpRequest || typeof mcpRequest !== 'object') {
        return {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32700, message: 'Parse error - invalid request object' }
        };
      }

      if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== '2.0') {
        return {
          jsonrpc: '2.0',
          id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
          error: { code: -32600, message: 'Invalid Request - jsonrpc must be "2.0"' }
        };
      }

      let result;
      switch (mcpRequest.method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'schedule-call-mcp-server', version: '1.0.0' }
          };
          break;

        case 'notifications/initialized':
          if (mcpRequest.id === null || mcpRequest.id === undefined) {
            return undefined;
          }
          return { jsonrpc: '2.0', id: mcpRequest.id, result: null };

        case 'tools/list':
          result = { tools: Array.from(this.tools.values()) };
          break;

        case 'tools/call':
          if (!mcpRequest.params || !mcpRequest.params.name) {
            return {
              jsonrpc: '2.0',
              id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
              error: { code: -32602, message: 'Invalid params - tool name is required' }
            };
          }
          const toolResult = await this.executeTool(mcpRequest.params.name, mcpRequest.params.arguments || {});
          result = {
            content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
          };
          break;

        default:
          return {
            jsonrpc: '2.0',
            id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
            error: { code: -32601, message: `Method not found: ${mcpRequest.method}` }
          };
      }

      return {
        jsonrpc: '2.0',
        id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
        result
      };

    } catch (error) {
      console.error('❌ Schedule Call MCP HTTP request error:', error);
      return {
        jsonrpc: '2.0',
        id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
        error: { code: -32603, message: 'Internal error', data: error.message }
      };
    }
  }
}

async function main() {
  const server = new ScheduleCallMCPServer();
  await server.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

module.exports = { ScheduleCallMCPServer };
