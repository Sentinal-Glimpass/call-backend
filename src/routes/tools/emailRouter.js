const express = require('express');
const multer = require('multer');
const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_ATTACHMENT_SIZE) || 10485760, // 10MB default
    files: 5 // Max 5 files per request
  }
});

// Import authentication middleware
const {
  authenticateSuperKey,
  authenticateJWTOrSuperKey,
  auditLog
} = require('../../middleware/authMiddleware');

// Import Email service functions
const {
  // Tool Management
  getEmailTools,
  createEmailTool,
  getEmailToolById,
  updateEmailTool,
  deleteEmailTool,

  // Templates & Validation
  getEmailTemplateTypes,
  testEmailConfiguration,

  // Email Templates Management
  getEmailTemplates,
  createEmailTemplate,
  getEmailTemplateById,
  updateEmailTemplate,
  deleteEmailTemplate,
  addTemplateAttachment,
  removeTemplateAttachment,

  // Agent Assignments
  getAgentEmailTools,
  assignEmailToolToAgent,
  removeEmailToolFromAgent,
  toggleEmailToolForAgent,

  // Bot Integration
  getEmailConfigForBot
} = require('../../services/tools/emailService');

/**
 * @swagger
 * tags:
 *   name: Gmail Tools
 *   description: Email messaging tool management
 */

// =============================================================================
// EMAIL TOOL MANAGEMENT
// =============================================================================

/**
 * @swagger
 * /api/tools/gmail:
 *   get:
 *     summary: Get client's email tools
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: enabled
 *         schema:
 *           type: boolean
 *         description: Filter by enabled status
 *       - in: query
 *         name: email_type
 *         schema:
 *           type: string
 *         description: Filter by email type
 *     responses:
 *       200:
 *         description: Email tools retrieved successfully
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
    if (req.query.email_type) {
      filters.email_type = req.query.email_type;
    }

    const result = await getEmailTools(clientId, filters);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching email tools:', error);
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
 * /api/tools/gmail:
 *   post:
 *     summary: Create new email tool
 *     tags: [Gmail Tools]
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
 *               - email_type
 *               - subject
 *               - body
 *             properties:
 *               tool_name:
 *                 type: string
 *                 description: Unique tool name
 *               email_type:
 *                 type: string
 *                 enum: [welcome, notification, followup, reminder, support, custom]
 *                 description: Type of email
 *               subject:
 *                 type: string
 *                 description: Email subject line
 *               body:
 *                 type: string
 *                 description: Email body content
 *               description:
 *                 type: string
 *                 description: Tool description
 *               variables:
 *                 type: array
 *                 description: Email template variables
 *               strategy:
 *                 type: string
 *                 enum: [immediate, conditional, scheduled, manual]
 *                 description: Execution strategy
 *               conditions:
 *                 type: array
 *                 description: Trigger conditions
 *               template_id:
 *                 type: string
 *                 description: Optional email template ID to use (overrides subject/body)
 *               enabled:
 *                 type: boolean
 *                 description: Tool enabled status
 *     responses:
 *       201:
 *         description: Email tool created successfully
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

    const result = await createEmailTool(toolData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error creating email tool:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// =============================================================================
// EMAIL TEMPLATES (moved here for route ordering)
// =============================================================================

/**
 * @swagger
 * /api/tools/gmail/templates/types:
 *   get:
 *     summary: Get email template types
 */
router.get('/templates/types', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const templateTypes = getEmailTemplateTypes();
    res.json({
      success: true,
      status: 200,
      message: 'Email template types retrieved successfully',
      data: templateTypes,
      count: templateTypes.length
    });
  } catch (error) {
    console.error('Error fetching email template types:', error);
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
 * /api/tools/gmail/templates:
 *   get:
 *     summary: Get email templates
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

    const filters = {};
    if (req.query.template_type) {
      filters.template_type = req.query.template_type;
    }

    const result = await getEmailTemplates(clientId, filters);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching email templates:', error);
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
 * /api/tools/gmail/{toolId}:
 *   get:
 *     summary: Get specific email tool
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: Email tool ID
 *     responses:
 *       200:
 *         description: Email tool retrieved successfully
 *       404:
 *         description: Tool not found
 */
router.get('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await getEmailToolById(toolId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching email tool:', error);
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
 * /api/tools/gmail/{toolId}:
 *   put:
 *     summary: Update email tool
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: Email tool ID
 *     responses:
 *       200:
 *         description: Email tool updated successfully
 *       404:
 *         description: Tool not found
 */
router.put('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await updateEmailTool(toolId, clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error updating email tool:', error);
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
 * /api/tools/gmail/{toolId}:
 *   delete:
 *     summary: Delete email tool
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: Email tool ID
 *     responses:
 *       200:
 *         description: Email tool deleted successfully
 *       400:
 *         description: Cannot delete - assigned to agents
 *       404:
 *         description: Tool not found
 */
router.delete('/:toolId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { toolId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await deleteEmailTool(toolId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error deleting email tool:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// =============================================================================
// EMAIL TEMPLATES AND CONFIGURATION
// =============================================================================

/**
 * @swagger
 * /api/tools/gmail/templates/types:
 *   get:
 *     summary: Get available email template types
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     responses:
 *       200:
 *         description: Email template types retrieved successfully
 */
router.get('/templates/types', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const templateTypes = getEmailTemplateTypes();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Email template types retrieved successfully',
      data: templateTypes,
      count: templateTypes.length
    });
  } catch (error) {
    console.error('Error fetching email template types:', error);
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
 * /api/tools/gmail/test-config:
 *   post:
 *     summary: Test email configuration
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               send_test:
 *                 type: boolean
 *                 description: Whether to send a test email
 *               test_email:
 *                 type: string
 *                 description: Email address to send test email to
 *     responses:
 *       200:
 *         description: Email configuration test successful
 *       400:
 *         description: Email configuration invalid
 *       404:
 *         description: Email credentials not found
 */
router.post('/test-config', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Client ID is required'
      });
    }

    const result = await testEmailConfiguration(clientId, req.body);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    console.error('Error testing email configuration:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// =============================================================================
// EMAIL TEMPLATES MANAGEMENT
// =============================================================================

/**
 * @swagger
 * /api/tools/gmail/templates:
 *   get:
 *     summary: Get client's email templates
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: template_type
 *         schema:
 *           type: string
 *         description: Filter by template type
 *     responses:
 *       200:
 *         description: Email templates retrieved successfully
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

    const filters = {};
    if (req.query.template_type) {
      filters.template_type = req.query.template_type;
    }

    const result = await getEmailTemplates(clientId, filters);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching email templates:', error);
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
 * /api/tools/gmail/templates:
 *   post:
 *     summary: Create new email template
 *     tags: [Gmail Tools]
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
 *               - template_name
 *               - template_type
 *             properties:
 *               template_name:
 *                 type: string
 *                 description: Unique template name
 *               template_type:
 *                 type: string
 *                 enum: [welcome, notification, followup, reminder, support, custom]
 *               subject:
 *                 type: string
 *                 description: Email subject template
 *               body_html:
 *                 type: string
 *                 description: HTML email body
 *               body_text:
 *                 type: string
 *                 description: Plain text email body
 *               variables:
 *                 type: array
 *                 description: Template variables
 *               description:
 *                 type: string
 *                 description: Template description
 *     responses:
 *       201:
 *         description: Email template created successfully
 *       400:
 *         description: Validation error or template name exists
 */
router.post('/templates', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await createEmailTemplate(clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error creating email template:', error);
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
 * /api/tools/gmail/templates/{templateId}:
 *   get:
 *     summary: Get specific email template
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Email template retrieved successfully
 *       404:
 *         description: Template not found
 */
router.get('/templates/:templateId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { templateId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await getEmailTemplateById(templateId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching email template:', error);
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
 * /api/tools/gmail/templates/{templateId}:
 *   put:
 *     summary: Update email template
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Email template updated successfully
 *       404:
 *         description: Template not found
 */
router.put('/templates/:templateId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { templateId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await updateEmailTemplate(templateId, clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error updating email template:', error);
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
 * /api/tools/gmail/templates/{templateId}:
 *   delete:
 *     summary: Delete email template
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Email template deleted successfully
 *       400:
 *         description: Cannot delete - used by email tools
 *       404:
 *         description: Template not found
 */
router.delete('/templates/:templateId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { templateId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await deleteEmailTemplate(templateId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error deleting email template:', error);
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
 * /api/tools/gmail/templates/{templateId}/attachments:
 *   post:
 *     summary: Upload attachment to email template
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               attachment:
 *                 type: string
 *                 format: binary
 *                 description: File to upload
 *     responses:
 *       200:
 *         description: Attachment uploaded successfully
 *       400:
 *         description: File validation error
 *       404:
 *         description: Template not found
 */
router.post('/templates/:templateId/attachments', authenticateJWTOrSuperKey, auditLog, upload.single('attachment'), async (req, res) => {
  try {
    const { templateId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'No file uploaded'
      });
    }

    const result = await addTemplateAttachment(templateId, clientId, req.file);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error uploading template attachment:', error);
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
 * /api/tools/gmail/templates/{templateId}/attachments/{attachmentId}:
 *   delete:
 *     summary: Remove attachment from email template
 *     tags: [Gmail Tools]
 *     security:
 *       - BearerAuth: []
 *       - SuperKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *       - in: path
 *         name: attachmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Attachment ID
 *     responses:
 *       200:
 *         description: Attachment removed successfully
 *       404:
 *         description: Template or attachment not found
 */
router.delete('/templates/:templateId/attachments/:attachmentId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { templateId, attachmentId } = req.params;
    const clientId = req.superKeyAuth ? req.query.client_id : req.user.clientId;

    const result = await removeTemplateAttachment(templateId, clientId, attachmentId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error removing template attachment:', error);
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
 * /api/tools/gmail/agents/{agentId}:
 *   get:
 *     summary: Get agent's email tool assignments
 *     tags: [Gmail Tools]
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
 *         description: Agent email tools retrieved successfully
 */
router.get('/agents/:agentId', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await getAgentEmailTools(agentId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching agent email tools:', error);
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
 * /api/tools/gmail/agents/{agentId}/assign:
 *   post:
 *     summary: Assign email tool to agent
 *     tags: [Gmail Tools]
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
 *               - email_tool_id
 *             properties:
 *               email_tool_id:
 *                 type: string
 *                 description: Email tool ID to assign
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
 *         description: Email tool assigned to agent successfully
 *       400:
 *         description: Tool already assigned
 *       404:
 *         description: Tool not found
 */
router.post('/agents/:agentId/assign', authenticateJWTOrSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const clientId = req.superKeyAuth ? req.body.client_id : req.user.clientId;

    const result = await assignEmailToolToAgent(agentId, clientId, req.body);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error assigning email tool to agent:', error);
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
 * /api/tools/gmail/agents/{agentId}/remove:
 *   delete:
 *     summary: Remove email tool from agent
 *     tags: [Gmail Tools]
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
 *         description: Email tool ID to remove
 *     responses:
 *       200:
 *         description: Email tool removed from agent successfully
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

    const result = await removeEmailToolFromAgent(agentId, tool_id);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error removing email tool from agent:', error);
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
 * /api/tools/gmail/agents/{agentId}/toggle:
 *   put:
 *     summary: Toggle email tool for agent
 *     tags: [Gmail Tools]
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
 *                 description: Email tool ID
 *               enabled:
 *                 type: boolean
 *                 description: Enable/disable status
 *     responses:
 *       200:
 *         description: Email tool toggle successful
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

    const result = await toggleEmailToolForAgent(agentId, tool_id, enabled);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error toggling email tool for agent:', error);
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
 * /api/tools/gmail/bot/{agentId}:
 *   get:
 *     summary: Get complete email configuration for bot
 *     tags: [Gmail Tools]
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
 *         description: Email configuration retrieved successfully
 *       404:
 *         description: No email tools assigned to agent
 */
router.get('/bot/:agentId', authenticateSuperKey, auditLog, async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await getEmailConfigForBot(agentId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching email config for bot:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;