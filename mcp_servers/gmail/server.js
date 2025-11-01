#!/usr/bin/env node
const { BaseMCPServer } = require('../shared/base-server.js');
const {
  makeInternalAPIRequest,
  getClientCredentials,
  validateEmail,
  replaceTemplateVariables,
  formatMCPResponse,
  createMCPSchema,
} = require('../shared/utils.js');
const TelephonyCredentialsService = require('../../src/services/telephonyCredentialsService');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config({ path: '../../.env' });

class GmailMCPServer extends BaseMCPServer {
  constructor() {
    super('gmail-mcp-server', '1.0.0');
    this.setupTools();
  }

  async setupTools() {
    // No static tools - will be dynamically loaded
  }

  async sendUserEmail(tool, args) {
    try {
      const { to, ...templateVars } = args;

      // Validate email address
      validateEmail(to);

      // Get template if tool uses template
      if (tool.template_id) {
        const templateResponse = await makeInternalAPIRequest(`/api/tools/gmail/templates?client_id=${this.clientId}`, {
          method: 'GET'
        });

        const template = templateResponse.data?.find(t => t._id === tool.template_id);
        if (!template) {
          throw new Error(`Email template not found`);
        }

        // Replace variables in template (missing vars will be replaced with empty string)
        const subject = replaceTemplateVariables(template.subject, templateVars);
        const body = replaceTemplateVariables(template.body_text || template.body_html, templateVars);

        console.log(`📧 Sending template email to ${to}`);
        console.log(`📧 Template vars:`, Object.keys(templateVars));

        // Send email using the internal send method
        return await this.sendEmail({
          client_id: this.clientId,
          to,
          subject,
          body,
          html: !!template.body_html
        });
      } else {
        // For non-template tools, use direct email sending
        return await this.sendEmail({
          client_id: this.clientId,
          to,
          subject: templateVars.subject || 'Email',
          body: templateVars.body || templateVars.content || 'No content',
          html: false
        });
      }

    } catch (error) {
      console.error('Error sending user email:', error);
      return formatMCPResponse(false, null, 'Failed to send email', error.message);
    }
  }

  async sendEmail(args) {
    try {
      this.validateArgs(args, ['client_id', 'to', 'subject', 'body']);

      const { client_id, to, subject, body, cc, bcc, html = false } = args;

      // Validate email addresses
      validateEmail(to);
      if (cc) validateEmail(cc);
      if (bcc) validateEmail(bcc);

      // Get Gmail credentials directly from service (provider is 'gmail', not 'email')
      console.log(`🔍 Getting Gmail credentials for client: ${client_id}`);
      const credentials = await TelephonyCredentialsService.getCredentials(client_id, 'gmail');

      if (!credentials || !credentials.gmail_user || !credentials.gmail_password) {
        throw new Error('Gmail credentials not found');
      }

      // Create transporter
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: credentials.gmail_user,
          pass: credentials.gmail_password
        }
      });

      // Prepare email options
      const mailOptions = {
        from: credentials.gmail_user,
        to: to,
        subject: subject,
        ...(html ? { html: body } : { text: body })
      };

      if (cc) mailOptions.cc = cc;
      if (bcc) mailOptions.bcc = bcc;

      console.log(`📧 Sending email to ${to} with subject: ${subject}`);

      // Send email
      const info = await transporter.sendMail(mailOptions);

      // Simplified response matching WATI pattern
      return formatMCPResponse(true, {
        message_id: info.messageId || 'sent',
        recipient: to,
        subject: subject
      }, 'Email sent successfully');

    } catch (error) {
      console.error('Error sending email:', error);
      return formatMCPResponse(false, null, 'Failed to send email', error.message);
    }
  }


  // HTTP handling methods for cross-server communication
  async setAgentContext(agentId, clientId) {
    this.agentId = agentId;
    this.clientId = clientId;
    console.log(`🔌 Gmail MCP Server context set: agentId=${agentId}, clientId=${clientId}`);
  }

  async handleHttpRequest(mcpRequest) {
    try {
      console.log('🔌 Processing Gmail MCP HTTP request:', JSON.stringify(mcpRequest, null, 2));

      // Handle potential parsing issues
      if (!mcpRequest || typeof mcpRequest !== 'object') {
        console.error('❌ Gmail MCP: Invalid request - not an object');
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
        console.error('❌ Gmail MCP: Missing jsonrpc field');
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
        console.error('❌ Gmail MCP: Invalid jsonrpc version:', mcpRequest.jsonrpc);
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
          console.log('🔌 Gmail MCP Server received initialized notification');
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
      console.error('❌ Gmail MCP HTTP request error:', error);
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
    console.log('🔌 Gmail MCP Server initialize called with params:', params);

    // Return MCP initialization response
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'gmail-mcp-server',
        version: '1.0.0'
      }
    };
  }

  async handleToolsList() {
    try {
      // Get agent's assigned email tools
      const response = await makeInternalAPIRequest(`/api/tools/gmail/agents/${this.agentId}`, {
        method: 'GET'
      });

      const tools = [];

      if (response.data?.assigned_tools && response.data.assigned_tools.length > 0) {
        for (const assignedTool of response.data.assigned_tools) {
          // Only include enabled tools
          if (assignedTool.enabled && assignedTool.tool_details) {
            const tool = assignedTool.tool_details;

            // Build schema with template variables so LLM knows what to extract
            const inputSchema = {
              type: 'object',
              properties: {
                to: { type: 'string', description: 'Recipient email address' }
              },
              required: ['to']
            };

            // Add template variables to schema if template exists
            if (tool.template_id) {
              try {
                const templateResponse = await makeInternalAPIRequest(`/api/tools/gmail/templates?client_id=${this.clientId}`, {
                  method: 'GET'
                });

                const template = templateResponse.data?.find(t => t._id === tool.template_id);
                if (template && template.variables) {
                  // Add template variables so LLM knows what to extract
                  for (const variable of template.variables) {
                    inputSchema.properties[variable.name] = {
                      type: 'string',
                      description: variable.description || `Template variable: ${variable.name}`
                    };
                    if (variable.required !== false) {
                      inputSchema.required.push(variable.name);
                    }
                  }
                }
              } catch (templateError) {
                console.error('Error fetching template for tool:', templateError);
              }
            }

            tools.push({
              name: tool.tool_name || tool.name,
              description: tool.description || 'Send email',
              inputSchema: inputSchema
            });
          }
        }
      }

      return { tools };
    } catch (error) {
      console.error('Error getting tools list:', error);
      return { tools: [] };
    }
  }

  async handleToolCall(toolName, args) {
    try {
      console.log(`📧 Gmail MCP tool call: ${toolName}`);
      console.log(`📧 Args received:`, JSON.stringify(args, null, 2));

      // Get agent's assigned email tools
      const response = await makeInternalAPIRequest(`/api/tools/gmail/agents/${this.agentId}`, {
        method: 'GET'
      });

      // Find the tool in assigned tools
      const assignedTool = response.data?.assigned_tools?.find(
        at => at.enabled && at.tool_details && (at.tool_details.tool_name || at.tool_details.name) === toolName
      );

      if (!assignedTool) {
        throw new Error(`Tool '${toolName}' not found or not assigned to agent`);
      }

      const tool = assignedTool.tool_details;

      // Simple validation - just check 'to' is provided
      if (!args.to) {
        throw new Error('Missing required parameter: to');
      }

      // Use the user-created tool to send email
      const result = await this.sendUserEmail(tool, args);

      // Create response text with size limit to prevent streaming issues
      const responseText = JSON.stringify(result, null, 2);
      const truncatedText = responseText.length > 1000
        ? JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.success ? { message_id: result.data?.message_id || 'sent' } : null
          }, null, 2)
        : responseText;

      console.log(`📧 Gmail MCP response size: ${truncatedText.length} chars`);

      // Return simplified MCP response format (matches WATI pattern)
      return {
        content: [
          {
            type: 'text',
            text: truncatedText
          }
        ]
      };
    } catch (error) {
      console.error('❌ Gmail MCP error in tool call:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formatMCPResponse(false, null, 'Failed to send email', error.message), null, 2)
          }
        ]
      };
    }
  }
}

// Start the server
async function main() {
  const server = new GmailMCPServer();
  await server.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

module.exports = { GmailMCPServer };