const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

/**
 * Base MCP Server Class
 * Provides common functionality for all internal MCP servers
 */
class BaseMCPServer {
  constructor(name, version = '1.0.0') {
    this.server = new Server(
      {
        name,
        version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.tools = new Map();
    this.setupHandlers();
  }

  /**
   * Setup common request handlers
   */
  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.tools.values()),
      };
    });

    // Execute tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!this.tools.has(name)) {
        throw new Error(`Tool ${name} not found`);
      }

      const tool = this.tools.get(name);

      try {
        const result = await this.executeTool(name, args || {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(`Error executing tool ${name}:`, error);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error.message,
                tool: name,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Register a tool with the server
   */
  registerTool(name, description, inputSchema, handler) {
    this.tools.set(name, {
      name,
      description,
      inputSchema,
    });

    // Store handler separately for execution
    if (!this.toolHandlers) {
      this.toolHandlers = new Map();
    }
    this.toolHandlers.set(name, handler);
  }

  /**
   * Execute a tool (to be overridden by subclasses)
   */
  async executeTool(name, args) {
    if (!this.toolHandlers || !this.toolHandlers.has(name)) {
      throw new Error(`No handler found for tool: ${name}`);
    }

    const handler = this.toolHandlers.get(name);
    return await handler(args);
  }

  /**
   * Start the server
   */
  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`${this.server.name} MCP server running on stdio`);
  }

  /**
   * Validate required arguments
   */
  validateArgs(args, required = []) {
    const missing = required.filter(key => !(key in args));
    if (missing.length > 0) {
      throw new Error(`Missing required arguments: ${missing.join(', ')}`);
    }
  }

  /**
   * Create standardized response
   */
  createResponse(success, data, error = null) {
    return {
      success,
      timestamp: new Date().toISOString(),
      ...(success ? { data } : { error }),
    };
  }
}

module.exports = { BaseMCPServer };