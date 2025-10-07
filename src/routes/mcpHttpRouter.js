const express = require('express');
const router = express.Router();

// Import authentication middleware
const { authenticateSuperKey, auditLog } = require('../middleware/authMiddleware');

// Import MCP server classes
const { WATIMCPServer } = require('../../mcp_servers/wati/server');
const { GmailMCPServer } = require('../../mcp_servers/gmail/server');

// Import services to get agent tool assignments
const { getAgentWatiTools } = require('../services/tools/watiService');
const { getAgentEmailTools } = require('../services/tools/emailService');
const { getAgentMcpTools } = require('../services/tools/mcpService');

/**
 * @swagger
 * tags:
 *   name: MCP HTTP
 *   description: HTTP-based MCP server endpoints for cross-server communication
 */

// =============================================================================
// WATI MCP HTTP ENDPOINT
// =============================================================================

/**
 * @swagger
 * /mcp/wati/{agentId}:
 *   post:
 *     summary: Execute WATI MCP tools via HTTP for specific agent
 *     tags: [MCP HTTP]
 *     security:
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent/Assistant ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: MCP protocol request
 *     responses:
 *       200:
 *         description: MCP response
 */
router.post('/wati/:agentId', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    let mcpRequest = req.body;

    // Handle potential body parsing issues
    if (typeof mcpRequest === 'string') {
      try {
        mcpRequest = JSON.parse(mcpRequest);
      } catch (parseError) {
        console.error(`❌ WATI MCP: Invalid JSON in request body`);
        return res.status(400).json({
          error: 'Invalid JSON in request body',
          code: -32700
        });
      }
    }

    if (!mcpRequest || typeof mcpRequest !== 'object') {
      console.error(`❌ WATI MCP: Invalid request body type`);
      return res.status(400).json({
        error: 'Request body must be a valid JSON object',
        code: -32700
      });
    }

    console.log(`🔌 WATI MCP: ${mcpRequest.method} → agent:${agentId}`);

    // Get agent's WATI tool assignments to determine client context
    const agentTools = await getAgentWatiTools(agentId);

    if (!agentTools.success || !agentTools.data.assigned_tools?.length) {
      console.warn(`⚠️ WATI MCP: No tools assigned to agent ${agentId}`);
      return res.status(404).json({
        error: 'No WATI tools assigned to agent',
        code: -32601
      });
    }

    // Create WATI MCP server instance with agent context
    const watiServer = new WATIMCPServer();
    await watiServer.setAgentContext(agentId, agentTools.data.client_id);

    // Handle MCP request
    const response = await watiServer.handleHttpRequest(mcpRequest);

    // Handle notifications (no response expected)
    if (response === undefined || response === null) {
      return res.status(200).end();
    }

    res.json(response);

  } catch (error) {
    console.error('❌ WATI MCP HTTP handler error:', error.message);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      code: -32603
    });
  }
});

// =============================================================================
// GMAIL MCP HTTP ENDPOINT
// =============================================================================

/**
 * @swagger
 * /mcp/gmail/{agentId}:
 *   post:
 *     summary: Execute Gmail MCP tools via HTTP for specific agent
 *     tags: [MCP HTTP]
 *     security:
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent/Assistant ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: MCP protocol request
 *     responses:
 *       200:
 *         description: MCP response
 */
router.post('/gmail/:agentId', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    let mcpRequest = req.body;

    console.log(`🔌 Gmail MCP HTTP request for agent: ${agentId}`);
    console.log(`📊 Gmail - Content-Length: ${req.headers['content-length']}`);
    console.log(`📊 Gmail - Content-Type: ${req.headers['content-type']}`);
    console.log(`🔍 Raw request body:`, JSON.stringify(req.body, null, 2));
    console.log(`🔍 Gmail body type: ${typeof req.body}`);
    console.log(`🔍 Gmail body keys: ${Object.keys(req.body || {})}`);

    // Check if req.rawBody exists for Gmail too
    if (req.rawBody) {
      console.log(`🔍 Gmail raw body buffer: ${req.rawBody.toString()}`);
    }

    // Handle potential body parsing issues in production
    if (typeof mcpRequest === 'string') {
      try {
        mcpRequest = JSON.parse(mcpRequest);
        console.log(`✅ Parsed string body to JSON`);
      } catch (parseError) {
        console.error(`❌ Failed to parse string body:`, parseError);
        return res.status(400).json({
          error: 'Invalid JSON in request body',
          code: -32700 // JSON-RPC parse error
        });
      }
    }

    // Additional validation for empty or null request
    if (!mcpRequest || typeof mcpRequest !== 'object') {
      console.error(`❌ Invalid request body type:`, typeof mcpRequest);
      return res.status(400).json({
        error: 'Request body must be a valid JSON object',
        code: -32700 // JSON-RPC parse error
      });
    }

    // Get agent's email tool assignments
    const agentTools = await getAgentEmailTools(agentId);

    if (!agentTools.success || !agentTools.data.assigned_tools?.length) {
      return res.status(404).json({
        error: 'No Gmail tools assigned to agent',
        code: -32601 // JSON-RPC method not found
      });
    }

    // Create Gmail MCP server instance with agent context
    const gmailServer = new GmailMCPServer();
    await gmailServer.setAgentContext(agentId, agentTools.data.client_id);

    // Handle MCP request
    const response = await gmailServer.handleHttpRequest(mcpRequest);

    // Handle notifications (no response expected)
    if (response === undefined || response === null) {
      return res.status(200).end(); // Empty response for notifications
    }

    res.json(response);

  } catch (error) {
    console.error('Error in Gmail MCP HTTP handler:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      code: -32603 // JSON-RPC internal error
    });
  }
});

// =============================================================================
// GENERIC MCP PROXY ENDPOINT
// =============================================================================

/**
 * @swagger
 * /mcp/generic/{agentId}/{toolId}:
 *   post:
 *     summary: Proxy to external MCP server for generic MCP tools
 *     tags: [MCP HTTP]
 *     security:
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent/Assistant ID
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: MCP Tool ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: MCP protocol request to proxy
 *     responses:
 *       200:
 *         description: Proxied MCP response
 */
router.post('/generic/:agentId/:toolId', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId, toolId } = req.params;
    let mcpRequest = req.body;

    console.log(`🔌 Generic MCP HTTP proxy for agent: ${agentId}, tool: ${toolId}`);
    console.log(`🔍 Raw request body:`, JSON.stringify(req.body, null, 2));

    // Handle potential body parsing issues in production
    if (typeof mcpRequest === 'string') {
      try {
        mcpRequest = JSON.parse(mcpRequest);
        console.log(`✅ Parsed string body to JSON`);
      } catch (parseError) {
        console.error(`❌ Failed to parse string body:`, parseError);
        return res.status(400).json({
          error: 'Invalid JSON in request body',
          code: -32700 // JSON-RPC parse error
        });
      }
    }

    // Additional validation for empty or null request
    if (!mcpRequest || typeof mcpRequest !== 'object') {
      console.error(`❌ Invalid request body type:`, typeof mcpRequest);
      return res.status(400).json({
        error: 'Request body must be a valid JSON object',
        code: -32700 // JSON-RPC parse error
      });
    }

    // Get agent's MCP tool assignments
    const agentTools = await getAgentMcpTools(agentId);

    if (!agentTools.success || !agentTools.data.assigned_tools?.length) {
      return res.status(404).json({
        error: 'No MCP tools assigned to agent',
        code: -32601
      });
    }

    // Find the specific tool
    const toolAssignment = agentTools.data.assigned_tools.find(
      tool => tool.mcp_tool_id === toolId && tool.enabled
    );

    if (!toolAssignment) {
      return res.status(404).json({
        error: 'MCP tool not found or not enabled for agent',
        code: -32601
      });
    }

    // For generic MCP tools, we would typically proxy to the actual external MCP server
    // For now, return a placeholder response indicating where the request should be proxied
    res.json({
      message: 'Generic MCP proxy - should forward to external server',
      toolId,
      agentId,
      originalRequest: mcpRequest,
      note: 'This would typically spawn/connect to the actual MCP server specified in tool config'
    });

  } catch (error) {
    console.error('Error in Generic MCP HTTP proxy:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      code: -32603
    });
  }
});

// =============================================================================
// MCP SERVER DISCOVERY ENDPOINT
// =============================================================================

/**
 * @swagger
 * /mcp/discover/{agentId}:
 *   get:
 *     summary: Discover available MCP servers for agent
 *     tags: [MCP HTTP]
 *     security:
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent/Assistant ID
 *     responses:
 *       200:
 *         description: Available MCP servers for agent
 */
router.get('/discover/:agentId', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;

    console.log(`🔍 MCP server discovery for agent: ${agentId}`);

    // Get all tool assignments for the agent
    const [watiTools, emailTools, mcpTools] = await Promise.all([
      getAgentWatiTools(agentId),
      getAgentEmailTools(agentId),
      getAgentMcpTools(agentId)
    ]);

    const servers = [];

    // WATI servers
    if (watiTools.success && watiTools.data.assigned_tools?.length > 0) {
      servers.push({
        type: 'wati',
        url: `/mcp/wati/${agentId}`,
        tools_count: watiTools.data.assigned_tools.filter(t => t.enabled).length,
        description: 'WATI WhatsApp messaging tools'
      });
    }

    // Gmail servers
    if (emailTools.success && emailTools.data.assigned_tools?.length > 0) {
      servers.push({
        type: 'gmail',
        url: `/mcp/gmail/${agentId}`,
        tools_count: emailTools.data.assigned_tools.filter(t => t.enabled).length,
        description: 'Gmail/SMTP email tools'
      });
    }

    // Generic MCP servers
    if (mcpTools.success && mcpTools.data.assigned_tools?.length > 0) {
      mcpTools.data.assigned_tools.filter(t => t.enabled).forEach(tool => {
        servers.push({
          type: 'generic_mcp',
          url: `/mcp/generic/${agentId}/${tool.mcp_tool_id}`,
          tool_id: tool.mcp_tool_id,
          description: 'Generic MCP tool'
        });
      });
    }

    res.json({
      success: true,
      agent_id: agentId,
      servers,
      total_servers: servers.length
    });

  } catch (error) {
    console.error('Error in MCP server discovery:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;