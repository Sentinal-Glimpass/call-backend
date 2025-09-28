const express = require('express');
const router = express.Router();
const { 
  authenticateToken, 
  auditLog 
} = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Tools
 *   description: Tools orchestration system for multi-channel communication
 */

const {
  // Tools Registry Management (System-level)
  createToolRegistry,
  getToolsRegistry,
  getToolRegistryById,
  updateToolRegistry,
  deleteToolRegistry,

  // Client Tool Configurations (Client-level)
  createClientToolConfig,
  getClientToolConfigs,
  getClientToolConfigById,
  updateClientToolConfig,
  deleteClientToolConfig,

  // Tool Orchestration (Runtime)
  getToolsSchemas,
  executeToolFunction,

  // Utility
  validateToolConfig,

  // Provider-specific
  getWatiTemplates
} = require('../apps/tools/tools.js');

const { initializeSystemTools } = require('../apps/tools/initializeSystemTools.js');

// =============================================================================
// SYSTEM INITIALIZATION (Admin only)
// =============================================================================

/**
 * @swagger
 * /api/tools/initialize:
 *   post:
 *     summary: Initialize system tools registry
 *     tags: [Tools]
 *     description: Creates base system tools like WATI messaging in the registry (Admin only)
 *     responses:
 *       200:
 *         description: System tools initialized successfully
 *       500:
 *         description: Error during initialization
 */
router.post('/initialize', authenticateToken, auditLog, async (req, res) => {
  try {
    await initializeSystemTools();
    res.status(200).json({
      success: true,
      message: 'System tools initialized successfully'
    });
  } catch (error) {
    console.error('Error initializing system tools:', error);
    res.status(500).json({
      success: false,
      message: 'Error initializing system tools',
      error: error.message
    });
  }
});

// =============================================================================
// TOOLS REGISTRY MANAGEMENT (System-level - Admin only)
// =============================================================================

/**
 * @swagger
 * /api/tools/registry:
 *   post:
 *     summary: Create a new tool in the system registry
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - openai_schema
 *               - endpoint_config
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique tool name (e.g., 'whatsapp', 'email')
 *               description:
 *                 type: string
 *                 description: Tool description
 *               openai_schema:
 *                 type: object
 *                 description: OpenAI function calling schema
 *               endpoint_config:
 *                 type: object
 *                 description: API endpoint configuration
 *               auth_requirements:
 *                 type: array
 *                 description: Required authentication parameters
 *               rate_limits:
 *                 type: object
 *                 description: Rate limiting configuration
 *     responses:
 *       201:
 *         description: Tool registry created successfully
 *       400:
 *         description: Invalid input or tool already exists
 */
router.post('/registry', authenticateToken, auditLog, async (req, res) => {
  try {
    const toolData = req.body;
    const result = await createToolRegistry(toolData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error creating tool registry:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/registry:
 *   get:
 *     summary: Get all available tools in the system registry
 *     tags: [Tools]
 *     responses:
 *       200:
 *         description: List of available tools
 */
router.get('/registry', authenticateToken, auditLog, async (req, res) => {
  try {
    const result = await getToolsRegistry();
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching tools registry:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/registry/{toolName}:
 *   get:
 *     summary: Get a specific tool from registry
 *     tags: [Tools]
 *     parameters:
 *       - in: path
 *         name: toolName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tool details
 *       404:
 *         description: Tool not found
 */
router.get('/registry/:toolName', authenticateToken, auditLog, async (req, res) => {
  try {
    const { toolName } = req.params;
    const result = await getToolRegistryById(toolName);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching tool registry:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/registry/{toolName}:
 *   put:
 *     summary: Update a tool in the registry
 *     tags: [Tools]
 *     parameters:
 *       - in: path
 *         name: toolName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tool updated successfully
 *       404:
 *         description: Tool not found
 */
router.put('/registry/:toolName', authenticateToken, auditLog, async (req, res) => {
  try {
    const { toolName } = req.params;
    const updateData = req.body;
    const result = await updateToolRegistry(toolName, updateData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error updating tool registry:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/registry/{toolName}:
 *   delete:
 *     summary: Delete a tool from the registry
 *     tags: [Tools]
 *     parameters:
 *       - in: path
 *         name: toolName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tool deleted successfully
 *       404:
 *         description: Tool not found
 */
router.delete('/registry/:toolName', authenticateToken, auditLog, async (req, res) => {
  try {
    const { toolName } = req.params;
    const result = await deleteToolRegistry(toolName);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error deleting tool registry:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// =============================================================================
// CLIENT TOOL CONFIGURATIONS (Client-level)
// =============================================================================

/**
 * @swagger
 * /api/tools/configs:
 *   post:
 *     summary: Create a new tool configuration for client
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - config_name
 *               - tool_name
 *               - enabled
 *             properties:
 *               config_name:
 *                 type: string
 *                 description: Unique name for this configuration
 *               tool_name:
 *                 type: string
 *                 description: Name of the tool from registry
 *               enabled:
 *                 type: boolean
 *                 description: Whether this configuration is active
 *               strategy:
 *                 type: string
 *                 enum: [immediate, conditional, scheduled, manual]
 *                 description: When to trigger this tool
 *               parameters:
 *                 type: object
 *                 description: Tool-specific configuration parameters
 *               credentials:
 *                 type: object
 *                 description: Client-specific API credentials
 *               conditions:
 *                 type: array
 *                 description: Conditions for conditional strategy
 *               rate_limits:
 *                 type: object
 *                 description: Client-specific rate limits
 *     responses:
 *       201:
 *         description: Tool configuration created successfully
 *       400:
 *         description: Invalid input or configuration already exists
 */
router.post('/configs', authenticateToken, auditLog, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const configData = { ...req.body, client_id: clientId };
    
    const result = await createClientToolConfig(configData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error creating tool configuration:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/configs:
 *   get:
 *     summary: Get all tool configurations for the authenticated client
 *     tags: [Tools]
 *     parameters:
 *       - in: query
 *         name: tool_name
 *         schema:
 *           type: string
 *         description: Filter by specific tool name
 *       - in: query
 *         name: enabled
 *         schema:
 *           type: boolean
 *         description: Filter by enabled status
 *     responses:
 *       200:
 *         description: List of tool configurations
 */
router.get('/configs', authenticateToken, auditLog, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const filters = { 
      client_id: clientId,
      ...req.query 
    };
    
    const result = await getClientToolConfigs(filters);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching tool configurations:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/configs/{configId}:
 *   get:
 *     summary: Get a specific tool configuration
 *     tags: [Tools]
 *     parameters:
 *       - in: path
 *         name: configId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tool configuration details
 *       404:
 *         description: Configuration not found
 */
router.get('/configs/:configId', authenticateToken, auditLog, async (req, res) => {
  try {
    const { configId } = req.params;
    const clientId = req.user.clientId;
    
    const result = await getClientToolConfigById(configId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching tool configuration:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/configs/{configId}:
 *   put:
 *     summary: Update a tool configuration
 *     tags: [Tools]
 *     parameters:
 *       - in: path
 *         name: configId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Configuration updated successfully
 *       404:
 *         description: Configuration not found
 */
router.put('/configs/:configId', authenticateToken, auditLog, async (req, res) => {
  try {
    const { configId } = req.params;
    const clientId = req.user.clientId;
    const updateData = req.body;
    
    const result = await updateClientToolConfig(configId, clientId, updateData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error updating tool configuration:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/configs/{configId}:
 *   delete:
 *     summary: Delete a tool configuration
 *     tags: [Tools]
 *     parameters:
 *       - in: path
 *         name: configId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Configuration deleted successfully
 *       404:
 *         description: Configuration not found
 */
router.delete('/configs/:configId', authenticateToken, auditLog, async (req, res) => {
  try {
    const { configId } = req.params;
    const clientId = req.user.clientId;
    
    const result = await deleteClientToolConfig(configId, clientId);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error deleting tool configuration:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// =============================================================================
// TOOL ORCHESTRATION (Runtime - Core Features)
// =============================================================================

/**
 * @swagger
 * /api/tools/schemas:
 *   get:
 *     summary: Get OpenAI function schemas for client's enabled tools
 *     tags: [Tools]
 *     parameters:
 *       - in: query
 *         name: campaign_id
 *         schema:
 *           type: string
 *         description: Filter tools by campaign assignment
 *       - in: query
 *         name: context
 *         schema:
 *           type: string
 *           enum: [campaign, call, incoming]
 *         description: Context for tool filtering
 *     responses:
 *       200:
 *         description: OpenAI function schemas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 message:
 *                   type: string
 *                 schemas:
 *                   type: array
 *                   description: Array of OpenAI function schemas
 */
router.get('/schemas', authenticateToken, auditLog, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const context = req.query;
    
    const result = await getToolsSchemas(clientId, context);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching tool schemas:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/execute:
 *   post:
 *     summary: Execute a tool function call
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - function_name
 *               - arguments
 *             properties:
 *               function_name:
 *                 type: string
 *                 description: Name of the function to execute
 *               arguments:
 *                 type: object
 *                 description: Function arguments
 *               config_id:
 *                 type: string
 *                 description: Specific config to use (optional)
 *               context:
 *                 type: object
 *                 description: Execution context (campaign_id, call_id, etc.)
 *     responses:
 *       200:
 *         description: Function executed successfully
 *       400:
 *         description: Invalid function call or arguments
 *       404:
 *         description: Function or configuration not found
 */
router.post('/execute', authenticateToken, auditLog, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { function_name, arguments: functionArgs, config_id, context } = req.body;
    
    const executionData = {
      client_id: clientId,
      function_name,
      arguments: functionArgs,
      config_id,
      context
    };
    
    const result = await executeToolFunction(executionData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error executing tool function:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// =============================================================================
// PROVIDER-SPECIFIC ENDPOINTS
// =============================================================================
// 
// Note: WATI functionality is available in the WATI section below
// All WATI endpoints: /api/tools/wati/* (templates, tools, registry, etc.)

// =============================================================================
// UTILITY ENDPOINTS
// =============================================================================

/**
 * @swagger
 * /api/tools/validate-config:
 *   post:
 *     summary: Validate a tool configuration before saving
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Tool configuration to validate
 *     responses:
 *       200:
 *         description: Configuration is valid
 *       400:
 *         description: Configuration validation failed
 */
router.post('/validate-config', authenticateToken, auditLog, async (req, res) => {
  try {
    const configData = req.body;
    const result = await validateToolConfig(configData);
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error validating tool configuration:', error);
    res.status(500).json({ 
      status: 500, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// =============================================================================
// WATI WHATSAPP INTEGRATION (Provider-specific tools functionality)
// =============================================================================

/**
 * @swagger
 * /api/tools/wati/templates:
 *   get:
 *     tags: [Tools]
 *     summary: Fetch available WATI WhatsApp templates for authenticated client
 *     description: Returns WATI message templates for the authenticated client using their stored credentials
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *         description: Filter templates by language (e.g., 'en', 'hi')
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter templates by category (e.g., 'MARKETING', 'UTILITY')
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter templates by status (e.g., 'APPROVED', 'PENDING')
 *     responses:
 *       200:
 *         description: WATI templates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 templates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       category:
 *                         type: string
 *                       language:
 *                         type: string
 *                       status:
 *                         type: string
 *                       variables:
 *                         type: array
 *                 count:
 *                   type: number
 *       404:
 *         description: WATI credentials not found
 *       500:
 *         description: Error fetching templates
 */
router.get('/wati/templates', authenticateToken, auditLog, async (req, res) => {
  try {
    // Get client ID from JWT token instead of URL parameter
    const clientId = req.user.clientId;
    const { language, category, status } = req.query;
    
    const result = await getWatiTemplates(clientId, { language, category, status });
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error fetching WATI templates:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/wati/tools:
 *   get:
 *     tags: [Tools]
 *     summary: Get WATI tools for authenticated client
 *     description: Retrieve all WATI tool configurations for the authenticated client
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: WATI tools retrieved successfully
 */
router.get('/wati/tools', authenticateToken, auditLog, async (req, res) => {
  try {
    // Get client ID from JWT token instead of URL parameter
    const clientId = req.user.clientId;

    // Filter for WATI tools only - pass client_id in filters
    const result = await getClientToolConfigs({
      client_id: clientId,
      provider: 'wati'
    });

    res.status(result.status || 200).json(result);
  } catch (error) {
    console.error('Error fetching WATI tools:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/tools/wati/tools:
 *   post:
 *     tags: [Tools]
 *     summary: Create WATI tool from template
 *     description: Create a new WATI tool configuration from a WhatsApp template for the authenticated client
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               templateName:
 *                 type: string
 *                 description: WATI template name
 *               toolName:
 *                 type: string
 *                 description: Custom tool name (optional, defaults to template name)
 *               description:
 *                 type: string
 *                 description: Tool description
 *               enabled:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: WATI tool created successfully
 */
router.post('/wati/tools', authenticateToken, auditLog, async (req, res) => {
  try {
    // Get client ID from JWT token instead of URL parameter
    const clientId = req.user.clientId;
    const { templateName, toolName, description, enabled = true } = req.body;
    
    if (!templateName) {
      return res.status(400).json({
        success: false,
        message: 'templateName is required'
      });
    }
    
    // First, get the template details to build the tool configuration
    const templateResult = await getWatiTemplates(clientId, { name: templateName });
    
    if (!templateResult.success || !templateResult.templates?.length) {
      return res.status(404).json({
        success: false,
        message: `WATI template '${templateName}' not found`
      });
    }
    
    const template = templateResult.templates[0];
    
    // Build tool configuration matching the expected schema
    const generatedToolName = toolName || `send_${template.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const registryToolName = 'wati_messaging'; // Always use the same registry tool

    // Verify WATI messaging tool exists in registry (should be created by system initialization)
    console.log(`🔍 Verifying ${registryToolName} exists in registry...`);
    const registryCheck = await getToolRegistryById(registryToolName);
    console.log(`📋 Registry check result:`, { status: registryCheck.status, message: registryCheck.message });

    if (registryCheck.status !== 200) {
      return res.status(500).json({
        success: false,
        message: `System tool '${registryToolName}' not found in registry`,
        error: 'Please contact administrator to initialize system tools',
        suggestion: 'The WATI messaging tool must be created in the system registry first'
      });
    }
    
    const toolData = {
      client_id: clientId,                                    // Required: client_id 
      config_name: generatedToolName,                         // Required: config_name
      tool_name: registryToolName,                           // Required: tool_name (reference to registry)
      enabled: enabled,                                       // Required: enabled
      description: description || `Send WhatsApp message using WATI template: ${template.name}`,
      provider: 'wati',
      category: 'messaging',
      configuration: {
        templateName: template.name,
        templateCategory: template.category,
        templateLanguage: template.language,
        variables: template.variables || [],
        // Client-specific OpenAI function schema for this template
        openaiSchema: {
          type: 'function',
          function: {
            name: generatedToolName,
            description: `Send WhatsApp message using WATI template: ${template.name}`,
            parameters: {
              type: 'object',
              properties: {
                recipient: {
                  type: 'string',
                  description: 'WhatsApp number to send message to (with country code)'
                },
                ...(template.variables && template.variables.length > 0 ? {
                  variables: {
                    type: 'object',
                    properties: template.variables.reduce((acc, variable) => {
                      acc[variable] = {
                        type: 'string',
                        description: `Value for template variable: ${variable}`
                      };
                      return acc;
                    }, {}),
                    required: template.variables
                  }
                } : {})
              },
              required: ['recipient']
            }
          }
        }
      }
    };
    
    const result = await createClientToolConfig(toolData);
    
    res.status(result.status || 201).json(result);
  } catch (error) {
    console.error('Error creating WATI tool:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/wati/tools/{toolId}:
 *   put:
 *     tags: [Tools]
 *     summary: Update WATI tool configuration
 *     description: Update an existing WATI tool configuration for the authenticated client
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: Tool configuration ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               enabled:
 *                 type: boolean
 *               configuration:
 *                 type: object
 *     responses:
 *       200:
 *         description: WATI tool updated successfully
 */
router.put('/wati/tools/:toolId', authenticateToken, auditLog, async (req, res) => {
  try {
    // Get client ID from JWT token instead of URL parameter
    const clientId = req.user.clientId;
    const { toolId } = req.params;
    const updates = req.body;
    
    const result = await updateClientToolConfig(toolId, clientId, updates);
    
    res.status(result.status || 200).json(result);
  } catch (error) {
    console.error('Error updating WATI tool:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/wati/tools/{toolId}:
 *   delete:
 *     tags: [Tools]
 *     summary: Delete WATI tool configuration
 *     description: Delete a WATI tool configuration for the authenticated client
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: Tool configuration ID
 *     responses:
 *       200:
 *         description: WATI tool deleted successfully
 */
router.delete('/wati/tools/:toolId', authenticateToken, auditLog, async (req, res) => {
  try {
    // Get client ID from JWT token instead of URL parameter
    const clientId = req.user.clientId;
    const { toolId } = req.params;
    
    const result = await deleteClientToolConfig(toolId, clientId);
    
    res.status(result.status || 200).json(result);
  } catch (error) {
    console.error('Error deleting WATI tool:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tools/wati/registry:
 *   get:
 *     tags: [Tools]
 *     summary: Get WATI tools from system registry
 *     description: Retrieve available WATI tools from the system registry
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: WATI registry tools retrieved successfully
 */
router.get('/wati/registry', authenticateToken, auditLog, async (req, res) => {
  try {
    // Filter for WATI tools only from system registry
    const result = await getToolsRegistry({ provider: 'wati' });
    
    res.status(result.status || 200).json(result);
  } catch (error) {
    console.error('Error fetching WATI registry tools:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

module.exports = router;