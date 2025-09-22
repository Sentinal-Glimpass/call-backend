const express = require('express');
const router = express.Router();

// Import authentication middleware
const {
  authenticateSuperKey,
  authenticateJWTOrSuperKey,
  auditLog
} = require('../../middleware/authMiddleware');

// Import MCP service functions
const {
  // Tool Management
  getMcpTools,
  createMcpTool,
  getMcpToolById,
  updateMcpTool,
  deleteMcpTool,

  // Agent Assignments
  getAgentMcpTools,
  assignMcpToolToAgent,
  removeMcpToolFromAgent,
  toggleMcpToolForAgent,

  // Bot Integration
  getMcpConfigForBot
} = require('../../services/tools/mcpService');

/**
 * @swagger
 * tags:
 *   name: MCP Tools
 *   description: Generic MCP (Model Context Protocol) tool management
 */

// =============================================================================
// MCP TOOL MANAGEMENT
// =============================================================================

/**
 * @swagger
 * /api/tools/mcp:
 *   get:
 *     summary: Get client's MCP tools
 *     tags: [MCP Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: enabled
 *         schema:
 *           type: boolean
 *         description: Filter by enabled status
 *     responses:
 *       200:
 *         description: MCP tools retrieved successfully
 */
router.get('/', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Client ID is required'
      });
    }

    const filters = {};
    if (req.query.enabled !== undefined) {
      filters.enabled = req.query.enabled === 'true';
    }

    const result = await getMcpTools(clientId, filters);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching MCP tools:', error);
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
 * /api/tools/mcp:
 *   post:
 *     summary: Create new MCP tool
 *     tags: [MCP Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tool_name
 *               - mcp_config
 *             properties:
 *               tool_name:
 *                 type: string
 *                 description: Unique tool name
 *               mcp_config:
 *                 type: object
 *                 description: Complete MCP server configuration JSON
 *               description:
 *                 type: string
 *                 description: Tool description
 *               mcp_identifier:
 *                 type: string
 *                 description: MCP identifier for bot integration
 *               strategy:
 *                 type: string
 *                 enum: [immediate, conditional, scheduled, manual]
 *                 description: Execution strategy
 *               conditions:
 *                 type: array
 *                 description: Trigger conditions
 *               enabled:
 *                 type: boolean
 *                 description: Tool enabled status
 *     responses:
 *       201:
 *         description: MCP tool created successfully
 *       400:
 *         description: Validation error or tool name exists
 */
router.post('/', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const toolData = {
      ...req.body,
      client_id: clientId
    };

    const result = await createMcpTool(toolData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error creating MCP tool:', error);
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
 * /api/tools/mcp/{toolId}:
 *   get:
 *     summary: Get specific MCP tool
 *     tags: [MCP Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: MCP tool ID
 *     responses:
 *       200:
 *         description: MCP tool retrieved successfully
 *       404:
 *         description: Tool not found
 */
router.get('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await getMcpToolById(toolId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching MCP tool:', error);
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
 * /api/tools/mcp/{toolId}:
 *   put:
 *     summary: Update MCP tool
 *     tags: [MCP Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: MCP tool ID
 *     responses:
 *       200:
 *         description: MCP tool updated successfully
 *       404:
 *         description: Tool not found
 */
router.put('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await updateMcpTool(toolId, clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error updating MCP tool:', error);
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
 * /api/tools/mcp/{toolId}:
 *   delete:
 *     summary: Delete MCP tool
 *     tags: [MCP Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: MCP tool ID
 *     responses:
 *       200:
 *         description: MCP tool deleted successfully
 *       400:
 *         description: Cannot delete - assigned to agents
 *       404:
 *         description: Tool not found
 */
router.delete('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await deleteMcpTool(toolId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error deleting MCP tool:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// =============================================================================
// AGENT ASSIGNMENTS
// =============================================================================

/**
 * @swagger
 * /api/tools/mcp/agents/{agentId}:
 *   get:
 *     summary: Get agent's MCP tool assignments
 *     tags: [MCP Tools]
 *     security:
 *       - BearerAuth: []
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
 *         description: Agent MCP tools retrieved successfully
 */
router.get('/agents/:agentId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await getAgentMcpTools(agentId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching agent MCP tools:', error);
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
 * /api/tools/mcp/agents/{agentId}/assign:
 *   post:
 *     summary: Assign MCP tool to agent
 *     tags: [MCP Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mcp_tool_id
 *             properties:
 *               mcp_tool_id:
 *                 type: string
 *                 description: MCP tool ID to assign
 *               enabled:
 *                 type: boolean
 *                 description: Assignment enabled status
 *               conditions_override:
 *                 type: array
 *                 description: Override tool conditions
 *               parameters_override:
 *                 type: object
 *                 description: Override MCP configuration parameters
 *     responses:
 *       200:
 *         description: MCP tool assigned to agent successfully
 *       400:
 *         description: Tool already assigned
 *       404:
 *         description: Tool not found
 */
router.post('/agents/:agentId/assign', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await assignMcpToolToAgent(agentId, clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error assigning MCP tool to agent:', error);
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
 * /api/tools/mcp/agents/{agentId}/remove:
 *   delete:
 *     summary: Remove MCP tool from agent
 *     tags: [MCP Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *       - in: query
 *         name: tool_id
 *         required: true
 *         schema:
 *           type: string
 *         description: MCP tool ID to remove
 *     responses:
 *       200:
 *         description: MCP tool removed from agent successfully
 *       404:
 *         description: Assignment not found
 */
router.delete('/agents/:agentId/remove', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { tool_id } = req.query;

    if (!tool_id) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'tool_id parameter is required'
      });
    }

    const result = await removeMcpToolFromAgent(agentId, tool_id);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error removing MCP tool from agent:', error);
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
 * /api/tools/mcp/agents/{agentId}/toggle:
 *   put:
 *     summary: Toggle MCP tool for agent
 *     tags: [MCP Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tool_id
 *               - enabled
 *             properties:
 *               tool_id:
 *                 type: string
 *                 description: MCP tool ID
 *               enabled:
 *                 type: boolean
 *                 description: Enable/disable status
 *     responses:
 *       200:
 *         description: MCP tool toggle successful
 *       404:
 *         description: Assignment not found
 */
router.put('/agents/:agentId/toggle', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { tool_id, enabled } = req.body;

    if (!tool_id || enabled === undefined) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'tool_id and enabled parameters are required'
      });
    }

    const result = await toggleMcpToolForAgent(agentId, tool_id, enabled);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error toggling MCP tool for agent:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// =============================================================================
// BOT INTEGRATION
// =============================================================================

/**
 * @swagger
 * /api/tools/mcp/bot/{agentId}:
 *   get:
 *     summary: Get complete MCP configuration for bot
 *     tags: [MCP Tools]
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
 *         description: MCP configuration retrieved successfully
 *       404:
 *         description: No MCP tools assigned to agent
 */
router.get('/bot/:agentId', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await getMcpConfigForBot(agentId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching MCP config for bot:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;