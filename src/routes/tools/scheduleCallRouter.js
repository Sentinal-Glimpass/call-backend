const express = require('express');
const router = express.Router();

// Import authentication middleware
const {
  authenticateSuperKey,
  authenticateJWTOrSuperKey,
  auditLog
} = require('../../middleware/authMiddleware');

// Import Schedule Call service functions
const {
  getScheduleCallTools,
  createScheduleCallTool,
  getScheduleCallToolById,
  updateScheduleCallTool,
  deleteScheduleCallTool,
  getAgentScheduleCallTools,
  assignScheduleCallToolToAgent,
  removeScheduleCallToolFromAgent,
  toggleScheduleCallToolForAgent,
  createScheduledCall,
  getScheduleCallConfigForBot
} = require('../../services/tools/scheduleCallService');

// =============================================================================
// SCHEDULE CALL TOOL MANAGEMENT
// =============================================================================

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

    const result = await getScheduleCallTools(clientId, filters);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching schedule call tools:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.post('/', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const toolData = {
      ...req.body,
      client_id: clientId
    };

    const result = await createScheduleCallTool(toolData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error creating schedule call tool:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.get('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await getScheduleCallToolById(toolId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching schedule call tool:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.put('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await updateScheduleCallTool(toolId, clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error updating schedule call tool:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.delete('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await deleteScheduleCallTool(toolId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error deleting schedule call tool:', error);
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

router.get('/agents/:agentId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await getAgentScheduleCallTools(agentId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching agent schedule call tools:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.post('/agents/:agentId/assign', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await assignScheduleCallToolToAgent(agentId, clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error assigning schedule call tool to agent:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.delete('/agents/:agentId/remove', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const tool_id = req.query.tool_id || req.body.tool_id;

    if (!tool_id) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'tool_id parameter is required (in query or body)'
      });
    }

    const result = await removeScheduleCallToolFromAgent(agentId, tool_id);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error removing schedule call tool from agent:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

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

    const result = await toggleScheduleCallToolForAgent(agentId, tool_id, enabled);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error toggling schedule call tool for agent:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// =============================================================================
// SCHEDULED CALL CREATION (called by MCP server internally)
// =============================================================================

router.post('/create-scheduled', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const result = await createScheduledCall(req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error creating scheduled call:', error);
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

router.get('/bot/:agentId', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await getScheduleCallConfigForBot(agentId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching schedule call config for bot:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
