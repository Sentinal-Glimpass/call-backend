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

  setupTools() {
    // Send email using template
    this.registerTool(
      'gmail_send_template_email',
      'Send email using Gmail/SMTP with template and variables',
      createMCPSchema({
        client_id: {
          type: 'string',
          description: 'Client ID for credential lookup'
        },
        to: {
          type: 'string',
          description: 'Recipient email address'
        },
        template_name: {
          type: 'string',
          description: 'Email template name to use'
        },
        variables: {
          type: 'object',
          description: 'Template variables as key-value pairs',
          default: {}
        },
        cc: {
          type: 'string',
          description: 'CC email address (optional)'
        },
        bcc: {
          type: 'string',
          description: 'BCC email address (optional)'
        }
      }, ['client_id', 'to', 'template_name']),
      this.sendTemplateEmail.bind(this)
    );

    // Send simple email
    this.registerTool(
      'gmail_send_email',
      'Send simple email via Gmail/SMTP',
      createMCPSchema({
        client_id: {
          type: 'string',
          description: 'Client ID for credential lookup'
        },
        to: {
          type: 'string',
          description: 'Recipient email address'
        },
        subject: {
          type: 'string',
          description: 'Email subject line'
        },
        body: {
          type: 'string',
          description: 'Email body content (HTML or plain text)'
        },
        cc: {
          type: 'string',
          description: 'CC email address (optional)'
        },
        bcc: {
          type: 'string',
          description: 'BCC email address (optional)'
        },
        html: {
          type: 'boolean',
          description: 'Whether body is HTML content',
          default: false
        }
      }, ['client_id', 'to', 'subject', 'body']),
      this.sendEmail.bind(this)
    );

    // Get email templates
    this.registerTool(
      'gmail_get_templates',
      'Get available email templates for client',
      createMCPSchema({
        client_id: {
          type: 'string',
          description: 'Client ID for template lookup'
        },
        template_type: {
          type: 'string',
          description: 'Filter by template type (welcome, notification, etc.)'
        }
      }, ['client_id']),
      this.getTemplates.bind(this)
    );
  }

  async sendTemplateEmail(args) {
    try {
      this.validateArgs(args, ['client_id', 'to', 'template_name']);

      const { client_id, to, template_name, variables = {}, cc, bcc } = args;

      // Validate email addresses
      validateEmail(to);
      if (cc) validateEmail(cc);
      if (bcc) validateEmail(bcc);

      // Get email template
      const templateResponse = await makeInternalAPIRequest('/api/tools/gmail/templates', {
        method: 'GET',
        params: { client_id, template_name }
      });

      const template = templateResponse.templates?.find(t => t.template_name === template_name);
      if (!template) {
        throw new Error(`Email template '${template_name}' not found`);
      }

      // Replace variables in template
      const subject = replaceTemplateVariables(template.subject, variables);
      const body = replaceTemplateVariables(template.body, variables);

      // Send email using the internal send method
      return await this.sendEmail({
        client_id,
        to,
        subject,
        body,
        cc,
        bcc,
        html: true // Templates are usually HTML
      });

    } catch (error) {
      console.error('Error sending template email:', error);
      return formatMCPResponse(false, null, 'Failed to send template email', error.message);
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

      console.log(`🔍 Credentials object: ${credentials ? 'YES' : 'NO'}`);
      console.log(`🔍 Credentials keys: ${credentials ? Object.keys(credentials) : 'NONE'}`);

      if (!credentials || !credentials.gmail_user) {
        throw new Error(`Gmail credentials not found for client: ${client_id}`);
      }
      console.log(`🔑 Email credentials found: ${credentials ? 'YES' : 'NO'}`);
      console.log(`📧 Gmail user configured: ${credentials.gmail_user ? 'YES' : 'NO'}`);

      if (!credentials.gmail_user || !credentials.gmail_password) {
        throw new Error('Gmail credentials (gmail_user, gmail_password) not found');
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

      console.error(`Sending email to ${to} with subject: ${subject}`);

      // Send email
      const info = await transporter.sendMail(mailOptions);

      return formatMCPResponse(true, {
        message_id: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        to: to,
        subject: subject,
        from: credentials.gmail_user
      }, 'Email sent successfully');

    } catch (error) {
      console.error('Error sending email:', error);
      return formatMCPResponse(false, null, 'Failed to send email', error.message);
    }
  }

  async getTemplates(args) {
    try {
      this.validateArgs(args, ['client_id']);

      const { client_id, template_type } = args;

      // Use internal API to get templates
      const params = { client_id };
      if (template_type) params.template_type = template_type;

      const response = await makeInternalAPIRequest('/api/tools/gmail/templates', {
        method: 'GET',
        params
      });

      return formatMCPResponse(true, {
        templates: response.templates || [],
        count: response.count || 0,
        template_type: template_type || 'all'
      }, 'Email templates retrieved successfully');

    } catch (error) {
      console.error('Error getting email templates:', error);
      return formatMCPResponse(false, null, 'Failed to get email templates', error.message);
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

      // Validate JSON-RPC 2.0 format
      if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== '2.0') {
        return {
          jsonrpc: '2.0',
          id: mcpRequest.id !== undefined ? mcpRequest.id : 0,
          error: {
            code: -32600,
            message: 'Invalid Request - missing or invalid jsonrpc field'
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
    return {
      tools: [
        {
          name: 'gmail_send_template_email',
          description: 'Send email using Gmail/SMTP with template and variables',
          inputSchema: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Recipient email address' },
              template_name: { type: 'string', description: 'Email template name to use' },
              variables: { type: 'object', description: 'Template variables', default: {} },
              cc: { type: 'string', description: 'CC email address (optional)' },
              bcc: { type: 'string', description: 'BCC email address (optional)' }
            },
            required: ['to', 'template_name']
          }
        },
        {
          name: 'gmail_send_email',
          description: 'Send simple email via Gmail/SMTP',
          inputSchema: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Recipient email address' },
              subject: { type: 'string', description: 'Email subject line' },
              body: { type: 'string', description: 'Email body content' },
              cc: { type: 'string', description: 'CC email address (optional)' },
              bcc: { type: 'string', description: 'BCC email address (optional)' },
              html: { type: 'boolean', description: 'Whether body is HTML', default: false }
            },
            required: ['to', 'subject', 'body']
          }
        },
        {
          name: 'gmail_get_templates',
          description: 'Get available email templates',
          inputSchema: {
            type: 'object',
            properties: {
              template_type: { type: 'string', description: 'Filter by template type' }
            }
          }
        }
      ]
    };
  }

  async handleToolCall(toolName, args) {
    // Add client_id to args from context
    const argsWithContext = {
      ...args,
      client_id: this.clientId
    };

    let result;
    switch (toolName) {
      case 'gmail_send_template_email':
        result = await this.sendTemplateEmail(argsWithContext);
        break;
      case 'gmail_send_email':
        result = await this.sendEmail(argsWithContext);
        break;
      case 'gmail_get_templates':
        result = await this.getTemplates(argsWithContext);
        break;
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

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