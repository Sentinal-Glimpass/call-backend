const express = require('express');
const router = express.Router();

// Import authentication middleware
const { authenticateSuperKey, auditLog } = require('../middleware/authMiddleware');

// Import services
const { getWatiConfigForBot } = require('../services/tools/watiService');
const { getEmailConfigForBot } = require('../services/tools/emailService');
const { getMcpConfigForBot } = require('../services/tools/mcpService');

/**
 * @swagger
 * tags:
 *   name: Bot Integration
 *   description: Unified MCP configuration for bot integration
 */

/**
 * @swagger
 * /api/bot-integration/{agentId}/mcp-config:
 *   get:
 *     summary: Get complete MCP configuration for bot (all tool types)
 *     tags: [Bot Integration]
 *     security:
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     responses:
 *       200:
 *         description: Complete MCP configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 agent_id:
 *                   type: string
 *                 client_id:
 *                   type: string
 *                 mcp_servers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       mcp_config:
 *                         type: object
 *                       tool_type:
 *                         type: string
 *                         enum: [wati, gmail, generic_mcp]
 *                       tools:
 *                         type: array
 *       404:
 *         description: No tools assigned to agent
 */
router.get('/:agentId/mcp-config', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;

    // Get all tool configurations in parallel
    const [watiResult, emailResult, mcpResult] = await Promise.all([
      getWatiConfigForBot(agentId),
      getEmailConfigForBot(agentId),
      getMcpConfigForBot(agentId)
    ]);

    const mcpServers = [];
    let clientId = null;

    // Process WATI tools
    if (watiResult.success && watiResult.wati_tools?.length > 0) {
      clientId = watiResult.client_id;

      // Group WATI tools by their MCP config (since they all use same server)
      const watiServer = {
        name: 'wati-internal-server',
        mcp_config: watiResult.wati_tools[0].mcp_config,
        tool_type: 'wati',
        tools: watiResult.wati_tools.map(tool => ({
          tool_id: tool.wati_tool_id,
          tool_name: tool.tool_name,
          mcp_identifier: tool.mcp_identifier,
          strategy: tool.strategy,
          final_conditions: tool.final_conditions,
          final_parameters: tool.final_parameters
        }))
      };

      mcpServers.push(watiServer);
    }

    // Process Gmail tools
    if (emailResult.success && emailResult.email_tools?.length > 0) {
      clientId = clientId || emailResult.client_id;

      const gmailServer = {
        name: 'gmail-internal-server',
        mcp_config: emailResult.email_tools[0].mcp_config,
        tool_type: 'gmail',
        tools: emailResult.email_tools.map(tool => ({
          tool_id: tool.email_tool_id,
          tool_name: tool.tool_name,
          mcp_identifier: tool.mcp_identifier,
          strategy: tool.strategy,
          final_conditions: tool.final_conditions,
          final_parameters: tool.final_parameters
        }))
      };

      mcpServers.push(gmailServer);
    }

    // Process Generic MCP tools
    if (mcpResult.success && mcpResult.mcp_tools?.length > 0) {
      clientId = clientId || mcpResult.client_id;

      // Each generic MCP tool gets its own server config
      mcpResult.mcp_tools.forEach(tool => {
        const mcpServer = {
          name: tool.mcp_identifier || tool.tool_name,
          mcp_config: tool.mcp_config,
          tool_type: 'generic_mcp',
          tools: [{
            tool_id: tool.mcp_tool_id,
            tool_name: tool.tool_name,
            mcp_identifier: tool.mcp_identifier,
            strategy: tool.strategy,
            final_conditions: tool.final_conditions
          }]
        };

        mcpServers.push(mcpServer);
      });
    }

    if (mcpServers.length === 0) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No MCP tools assigned to agent'
      });
    }

    return res.json({
      success: true,
      status: 200,
      agent_id: agentId,
      client_id: clientId,
      mcp_servers: mcpServers,
      total_servers: mcpServers.length,
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting unified MCP config:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/bot-integration/{agentId}/tools-summary:
 *   get:
 *     summary: Get summary of all tools assigned to agent
 *     tags: [Bot Integration]
 *     security:
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     responses:
 *       200:
 *         description: Tools summary retrieved successfully
 */
router.get('/:agentId/tools-summary', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;

    // Get all tool configurations in parallel
    const [watiResult, emailResult, mcpResult] = await Promise.all([
      getWatiConfigForBot(agentId),
      getEmailConfigForBot(agentId),
      getMcpConfigForBot(agentId)
    ]);

    const summary = {
      agent_id: agentId,
      tool_types: {
        wati: {
          enabled: watiResult.success,
          count: watiResult.wati_tools?.length || 0,
          tools: watiResult.wati_tools?.map(t => ({
            id: t.wati_tool_id,
            name: t.tool_name,
            strategy: t.strategy
          })) || []
        },
        gmail: {
          enabled: emailResult.success,
          count: emailResult.email_tools?.length || 0,
          tools: emailResult.email_tools?.map(t => ({
            id: t.email_tool_id,
            name: t.tool_name,
            strategy: t.strategy
          })) || []
        },
        generic_mcp: {
          enabled: mcpResult.success,
          count: mcpResult.mcp_tools?.length || 0,
          tools: mcpResult.mcp_tools?.map(t => ({
            id: t.mcp_tool_id,
            name: t.tool_name,
            strategy: t.strategy
          })) || []
        }
      },
      total_tools: (watiResult.wati_tools?.length || 0) +
                   (emailResult.email_tools?.length || 0) +
                   (mcpResult.mcp_tools?.length || 0)
    };

    res.json({
      success: true,
      status: 200,
      data: summary
    });

  } catch (error) {
    console.error('Error getting tools summary:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;