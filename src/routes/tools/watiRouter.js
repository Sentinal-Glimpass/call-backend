const express = require('express');
const router = express.Router();

// Import authentication middleware
const {
  authenticateSuperKey,
  authenticateJWTOrSuperKey,
  auditLog
} = require('../../middleware/authMiddleware');

// Import WATI service functions
const {
  // Tool Management
  getWatiTools,
  createWatiTool,
  getWatiToolById,
  updateWatiTool,
  deleteWatiTool,

  // Templates
  getWatiTemplates,

  // Agent Assignments
  getAgentWatiTools,
  assignWatiToolToAgent,
  removeWatiToolFromAgent,
  toggleWatiToolForAgent,

  // Bot Integration
  getWatiConfigForBot
} = require('../../services/tools/watiService');

/**
 * @swagger
 * tags:
 *   name: WATI Tools
 *   description: WATI WhatsApp messaging tool management
 */

// =============================================================================
// WATI TOOL MANAGEMENT
// =============================================================================

/**
 * @swagger
 * /api/tools/wati:
 *   get:
 *     summary: Get client's WATI tools
 *     tags: [WATI Tools]
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
 *         description: WATI tools retrieved successfully
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

    const result = await getWatiTools(clientId, filters);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching WATI tools:', error);
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
 * /api/tools/wati:
 *   post:
 *     summary: Create new WATI tool
 *     tags: [WATI Tools]
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
 *               - template_id
 *             properties:
 *               tool_name:
 *                 type: string
 *                 description: Unique tool name
 *               template_id:
 *                 type: string
 *                 description: WATI template identifier
 *               description:
 *                 type: string
 *                 description: Tool description
 *               language:
 *                 type: string
 *                 description: Template language
 *               variables:
 *                 type: array
 *                 description: Template variables
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
 *         description: WATI tool created successfully
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

    const result = await createWatiTool(toolData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error creating WATI tool:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// =============================================================================
// TEMPLATES
// =============================================================================

/**
 * @swagger
 * /api/tools/wati/templates:
 *   get:
 *     summary: Get WATI templates from API
 *     tags: [WATI Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *         description: Filter by language
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: WATI templates retrieved successfully
 *       404:
 *         description: WATI credentials not found
 */
router.get('/templates', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Client ID is required'
      });
    }

    const filters = {
      language: req.query.language,
      category: req.query.category,
      status: req.query.status
    };

    const result = await getWatiTemplates(clientId, filters);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching WATI templates:', error);
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
 * /api/tools/wati/{toolId}:
 *   get:
 *     summary: Get specific WATI tool
 *     tags: [WATI Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: WATI tool ID
 *     responses:
 *       200:
 *         description: WATI tool retrieved successfully
 *       404:
 *         description: Tool not found
 */
router.get('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await getWatiToolById(toolId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching WATI tool:', error);
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
 * /api/tools/wati/{toolId}:
 *   put:
 *     summary: Update WATI tool
 *     tags: [WATI Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: WATI tool ID
 *     responses:
 *       200:
 *         description: WATI tool updated successfully
 *       404:
 *         description: Tool not found
 */
router.put('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await updateWatiTool(toolId, clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error updating WATI tool:', error);
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
 * /api/tools/wati/{toolId}:
 *   delete:
 *     summary: Delete WATI tool
 *     tags: [WATI Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: WATI tool ID
 *     responses:
 *       200:
 *         description: WATI tool deleted successfully
 *       400:
 *         description: Cannot delete - assigned to agents
 *       404:
 *         description: Tool not found
 */
router.delete('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await deleteWatiTool(toolId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error deleting WATI tool:', error);
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
 * /api/tools/wati/agents/{agentId}:
 *   get:
 *     summary: Get agent's WATI tool assignments
 *     tags: [WATI Tools]
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
 *         description: Agent WATI tools retrieved successfully
 */
router.get('/agents/:agentId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await getAgentWatiTools(agentId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching agent WATI tools:', error);
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
 * /api/tools/wati/agents/{agentId}/assign:
 *   post:
 *     summary: Assign WATI tool to agent
 *     tags: [WATI Tools]
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
 *               - wati_tool_id
 *             properties:
 *               wati_tool_id:
 *                 type: string
 *                 description: WATI tool ID to assign
 *               enabled:
 *                 type: boolean
 *                 description: Assignment enabled status
 *               conditions_override:
 *                 type: array
 *                 description: Override tool conditions
 *               parameters_override:
 *                 type: object
 *                 description: Override tool parameters
 *     responses:
 *       200:
 *         description: WATI tool assigned to agent successfully
 *       400:
 *         description: Tool already assigned
 *       404:
 *         description: Tool not found
 */
router.post('/agents/:agentId/assign', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await assignWatiToolToAgent(agentId, clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error assigning WATI tool to agent:', error);
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
 * /api/tools/wati/agents/{agentId}/remove:
 *   delete:
 *     summary: Remove WATI tool from agent
 *     tags: [WATI Tools]
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
 *         description: WATI tool ID to remove
 *     responses:
 *       200:
 *         description: WATI tool removed from agent successfully
 *       404:
 *         description: Assignment not found
 */
router.delete('/agents/:agentId/remove', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    // Support tool_id from both query parameters and request body for flexibility
    const tool_id = req.query.tool_id || req.body.tool_id;

    if (!tool_id) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'tool_id parameter is required (in query or body)'
      });
    }

    const result = await removeWatiToolFromAgent(agentId, tool_id);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error removing WATI tool from agent:', error);
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
 * /api/tools/wati/agents/{agentId}/toggle:
 *   put:
 *     summary: Toggle WATI tool for agent
 *     tags: [WATI Tools]
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
 *                 description: WATI tool ID
 *               enabled:
 *                 type: boolean
 *                 description: Enable/disable status
 *     responses:
 *       200:
 *         description: WATI tool toggle successful
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

    const result = await toggleWatiToolForAgent(agentId, tool_id, enabled);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error toggling WATI tool for agent:', error);
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
 * /api/tools/wati/bot/{agentId}:
 *   get:
 *     summary: Get complete WATI configuration for bot
 *     tags: [WATI Tools]
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
 *         description: WATI configuration retrieved successfully
 *       404:
 *         description: No WATI tools assigned to agent
 */
router.get('/bot/:agentId', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await getWatiConfigForBot(agentId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching WATI config for bot:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;