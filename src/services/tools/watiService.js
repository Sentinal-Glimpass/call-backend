const { connectToMongo, client } = require('../../../models/mongodb.js');
const { ObjectId } = require('mongodb');
const axios = require('axios');
const crypto = require('crypto');
const TelephonyCredentialsService = require('../telephonyCredentialsService');

/**
 * WATI Tool Service
 *
 * Manages WATI-specific tool configurations and operations:
 * - WATI tool instances (watiTools collection)
 * - Agent assignments (agentWatiTools collection)
 * - Template fetching and management
 * - Bot integration with encrypted credentials
 */

// =============================================================================
// WATI TOOL INSTANCES MANAGEMENT
// =============================================================================

/**
 * Get WATI tool instances for client
 */
async function getWatiTools(clientId, filters = {}) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const query = { client_id: clientId, ...filters };
    const tools = await db.collection('watiTools').find(query).toArray();

    return {
      success: true,
      status: 200,
      message: 'WATI tools retrieved successfully',
      data: tools,
      count: tools.length
    };
  } catch (error) {
    console.error('Error fetching WATI tools:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching WATI tools',
      error: error.message
    };
  }
}

/**
 * Create new WATI tool instance
 */
async function createWatiTool(toolData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Check for duplicate tool name within client
    const existingTool = await db.collection('watiTools')
      .findOne({
        client_id: toolData.client_id,
        tool_name: toolData.tool_name
      });

    if (existingTool) {
      return {
        success: false,
        status: 400,
        message: `WATI tool '${toolData.tool_name}' already exists for this client`
      };
    }

    // Validate required fields
    if (!toolData.template_id || !toolData.tool_name || !toolData.template_name) {
      return {
        success: false,
        status: 400,
        message: 'template_id, tool_name, and template_name are required'
      };
    }

    const watiTool = {
      ...toolData,
      enabled: toolData.enabled !== undefined ? toolData.enabled : true,
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('watiTools').insertOne(watiTool);

    return {
      success: true,
      status: 201,
      message: 'WATI tool created successfully',
      data: { _id: result.insertedId, ...watiTool }
    };
  } catch (error) {
    console.error('Error creating WATI tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error creating WATI tool',
      error: error.message
    };
  }
}

/**
 * Get specific WATI tool
 */
async function getWatiToolById(toolId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const tool = await db.collection('watiTools')
      .findOne({
        _id: new ObjectId(toolId),
        client_id: clientId
      });

    if (!tool) {
      return {
        success: false,
        status: 404,
        message: 'WATI tool not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'WATI tool retrieved successfully',
      data: tool
    };
  } catch (error) {
    console.error('Error fetching WATI tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching WATI tool',
      error: error.message
    };
  }
}

/**
 * Update WATI tool
 */
async function updateWatiTool(toolId, clientId, updateData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const updateDoc = {
      ...updateData,
      updated_at: new Date()
    };

    const result = await db.collection('watiTools')
      .findOneAndUpdate(
        { _id: new ObjectId(toolId), client_id: clientId },
        { $set: updateDoc },
        { returnDocument: 'after' }
      );

    if (!result) {
      return {
        success: false,
        status: 404,
        message: 'WATI tool not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'WATI tool updated successfully',
      data: result
    };
  } catch (error) {
    console.error('Error updating WATI tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error updating WATI tool',
      error: error.message
    };
  }
}

/**
 * Delete WATI tool
 */
async function deleteWatiTool(toolId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Check if tool is assigned to any agents
    const assignmentCount = await db.collection('agentWatiTools')
      .countDocuments({
        'assigned_tools.wati_tool_id': new ObjectId(toolId)
      });

    if (assignmentCount > 0) {
      return {
        success: false,
        status: 400,
        message: `Cannot delete WATI tool. It is assigned to ${assignmentCount} agents.`
      };
    }

    const result = await db.collection('watiTools')
      .deleteOne({
        _id: new ObjectId(toolId),
        client_id: clientId
      });

    if (result.deletedCount === 0) {
      return {
        success: false,
        status: 404,
        message: 'WATI tool not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'WATI tool deleted successfully'
    };
  } catch (error) {
    console.error('Error deleting WATI tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error deleting WATI tool',
      error: error.message
    };
  }
}

// =============================================================================
// WATI TEMPLATES MANAGEMENT
// =============================================================================

/**
 * Get WATI templates from API
 */
async function getWatiTemplates(clientId, filters = {}) {
  try {
    // Get WATI credentials for client
    const credentials = await TelephonyCredentialsService.getClientCredentials(clientId);

    if (!credentials.wati) {
      return {
        success: false,
        status: 404,
        message: 'WATI credentials not found for client'
      };
    }

    let { accessToken } = credentials.wati;

    if (!accessToken) {
      return {
        success: false,
        status: 400,
        message: 'WATI access token is required'
      };
    }

    // Remove "Bearer " prefix if present
    if (accessToken.startsWith('Bearer ')) {
      accessToken = accessToken.substring(7);
    }

    // Extract tenant ID from JWT token if available
    let tenantId = null;
    try {
      const tokenPayload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
      tenantId = tokenPayload.tenant_id;
      console.log(`🔍 Extracted tenant ID from JWT: ${tenantId}`);
    } catch (error) {
      console.warn(`⚠️ Could not extract tenant ID from token: ${error.message}`);
    }

    // Build WATI API URL with tenant ID if available
    const baseUrl = tenantId
      ? `https://live-mt-server.wati.io/${tenantId}/api/v1`
      : 'https://live-mt-server.wati.io/api/v1';

    // Build pagination parameters - default to first 100 templates for backward compatibility
    const limit = filters.limit || 100;
    const cursor = filters.cursor || null;

    let apiUrl = `${baseUrl}/getMessageTemplates`;
    const queryParams = new URLSearchParams();

    // Add pagination parameters
    queryParams.append('limit', limit.toString());
    if (cursor) {
      queryParams.append('cursor', cursor);
    }

    // Add query parameters if any
    if (queryParams.toString()) {
      apiUrl += `?${queryParams.toString()}`;
    }

    console.log(`🌐 Using WATI API URL: ${apiUrl}`);

    // Fetch templates from WATI API
    const watiResponse = await axios.get(apiUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`🔍 Raw WATI API response:`, JSON.stringify(watiResponse.data, null, 2));

    let templates = watiResponse.data.messageTemplates || [];

    // Apply filters after fetching
    if (filters.language) {
      templates = templates.filter(t => t.language === filters.language);
    }
    if (filters.category) {
      templates = templates.filter(t => t.category === filters.category);
    }
    if (filters.status) {
      templates = templates.filter(t => t.status === filters.status);
    }

    // Transform templates with more complete data mapping
    const formattedTemplates = templates.map(template => {
      console.log(`🔍 Processing template:`, JSON.stringify(template, null, 2));

      return {
        // Try multiple possible field names for template name
        name: template.name || template.templateName || template.template_name || template.elementName || `Template_${template.id || 'unknown'}`,
        id: template.id || template.templateId,
        category: template.category,
        language: template.language,
        status: template.status,
        namespace: template.namespace,
        createdOn: template.createdOn,
        modifiedOn: template.modifiedOn,
        variables: extractTemplateVariables(template.components || []),
        components: template.components || [],
        // Include original template data for debugging
        _original: template
      };
    });

    // Extract pagination info from response
    const paginationInfo = {
      total: watiResponse.data.total || templates.length,
      count: formattedTemplates.length,
      hasNextPage: watiResponse.data.hasNextPage || false,
      nextCursor: watiResponse.data.nextCursor || null,
      limit: limit
    };

    return {
      success: true,
      status: 200,
      templates: formattedTemplates,
      pagination: paginationInfo,
      count: formattedTemplates.length
    };

  } catch (error) {
    console.error('Error fetching WATI templates:', error);
    console.error('Error response data:', error.response?.data);
    return {
      success: false,
      status: error.response?.status || 500,
      message: error.response?.data?.message || 'Error fetching WATI templates',
      error: error.message
    };
  }
}

/**
 * Extract variables from WATI template components
 */
function extractTemplateVariables(components) {
  const variables = [];

  components.forEach(component => {
    if (component.type === 'BODY' && component.text) {
      const matches = component.text.match(/\{\{(\w+)\}\}/g);
      if (matches) {
        matches.forEach(match => {
          const variable = match.replace(/\{\{|\}\}/g, '');
          if (!variables.includes(variable)) {
            variables.push(variable);
          }
        });
      }
    }
  });

  return variables;
}


// =============================================================================
// AGENT ASSIGNMENTS
// =============================================================================

/**
 * Get agent's WATI tool assignments
 */
async function getAgentWatiTools(agentId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const assignment = await db.collection('agentWatiTools')
      .findOne({ agent_id: agentId });

    if (!assignment) {
      return {
        success: true,
        status: 200,
        message: 'No WATI tools assigned to agent',
        data: {
          agent_id: agentId,
          assigned_tools: []
        }
      };
    }

    // Enrich with tool details
    const enrichedTools = await Promise.all(
      assignment.assigned_tools.map(async (assignedTool) => {
        const tool = await db.collection('watiTools')
          .findOne({ _id: assignedTool.wati_tool_id });

        return {
          ...assignedTool,
          tool_details: tool
        };
      })
    );

    return {
      success: true,
      status: 200,
      message: 'Agent WATI tools retrieved successfully',
      data: {
        ...assignment,
        assigned_tools: enrichedTools
      }
    };
  } catch (error) {
    console.error('Error fetching agent WATI tools:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching agent WATI tools',
      error: error.message
    };
  }
}

/**
 * Assign WATI tool to agent
 */
async function assignWatiToolToAgent(agentId, clientId, assignmentData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Support multiple field names for backward compatibility
    const toolId = assignmentData.wati_tool_id || assignmentData.toolId || assignmentData.tool_id;

    if (!toolId) {
      return {
        success: false,
        status: 400,
        message: 'wati_tool_id, toolId, or tool_id is required'
      };
    }

    // Validate tool exists and belongs to client
    const tool = await db.collection('watiTools')
      .findOne({
        _id: new ObjectId(toolId),
        client_id: clientId
      });

    if (!tool) {
      return {
        success: false,
        status: 404,
        message: 'WATI tool not found or does not belong to client'
      };
    }

    const assignment = {
      wati_tool_id: new ObjectId(toolId),
      enabled: assignmentData.enabled !== undefined ? assignmentData.enabled : true,
      conditions_override: assignmentData.conditions_override || null,
      parameters_override: assignmentData.parameters_override || {}
    };

    // Check if already assigned
    const existingAssignment = await db.collection('agentWatiTools')
      .findOne({
        agent_id: agentId,
        'assigned_tools.wati_tool_id': assignment.wati_tool_id
      });

    if (existingAssignment) {
      return {
        success: false,
        status: 400,
        message: 'WATI tool already assigned to agent'
      };
    }

    // Add to existing assignment or create new
    const result = await db.collection('agentWatiTools')
      .findOneAndUpdate(
        { agent_id: agentId },
        {
          $push: { assigned_tools: assignment },
          $setOnInsert: {
            agent_id: agentId,
            client_id: clientId,
            created_at: new Date()
          },
          $set: { updated_at: new Date() }
        },
        {
          upsert: true,
          returnDocument: 'after'
        }
      );

    return {
      success: true,
      status: 200,
      message: 'WATI tool assigned to agent successfully',
      data: result
    };
  } catch (error) {
    console.error('Error assigning WATI tool to agent:', error);
    return {
      success: false,
      status: 500,
      message: 'Error assigning WATI tool to agent',
      error: error.message
    };
  }
}

/**
 * Remove WATI tool from agent
 */
async function removeWatiToolFromAgent(agentId, toolId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const result = await db.collection('agentWatiTools')
      .findOneAndUpdate(
        { agent_id: agentId },
        {
          $pull: {
            assigned_tools: {
              wati_tool_id: new ObjectId(toolId)
            }
          },
          $set: { updated_at: new Date() }
        },
        { returnDocument: 'after' }
      );

    if (!result) {
      return {
        success: false,
        status: 404,
        message: 'Agent assignment not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'WATI tool removed from agent successfully'
    };
  } catch (error) {
    console.error('Error removing WATI tool from agent:', error);
    return {
      success: false,
      status: 500,
      message: 'Error removing WATI tool from agent',
      error: error.message
    };
  }
}

/**
 * Toggle WATI tool for agent
 */
async function toggleWatiToolForAgent(agentId, toolId, enabled) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const result = await db.collection('agentWatiTools')
      .findOneAndUpdate(
        {
          agent_id: agentId,
          'assigned_tools.wati_tool_id': new ObjectId(toolId)
        },
        {
          $set: {
            'assigned_tools.$.enabled': enabled,
            updated_at: new Date()
          }
        },
        { returnDocument: 'after' }
      );

    if (!result) {
      return {
        success: false,
        status: 404,
        message: 'WATI tool assignment not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: `WATI tool ${enabled ? 'enabled' : 'disabled'} for agent successfully`
    };
  } catch (error) {
    console.error('Error toggling WATI tool for agent:', error);
    return {
      success: false,
      status: 500,
      message: 'Error toggling WATI tool for agent',
      error: error.message
    };
  }
}

// =============================================================================
// BOT INTEGRATION
// =============================================================================

/**
 * Encrypt credentials for bot transmission
 */
async function encryptCredentials(credentials, masterKey) {
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher(algorithm, masterKey);

  let encrypted = cipher.update(JSON.stringify(credentials), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Get complete WATI configuration for bot (Legacy format for botIntegrationRouter)
 */
async function getWatiConfigForBot(agentId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Get agent assignments
    const assignment = await db.collection('agentWatiTools')
      .findOne({ agent_id: agentId });

    if (!assignment) {
      return {
        success: false,
        status: 404,
        message: 'No WATI tools assigned to agent'
      };
    }

    // Get enabled tools
    const enabledTools = assignment.assigned_tools.filter(tool => tool.enabled);
    const toolIds = enabledTools.map(t => t.wati_tool_id);

    const tools = await db.collection('watiTools')
      .find({ _id: { $in: toolIds } }).toArray();

    // Get credentials for client
    const credentials = await TelephonyCredentialsService.getClientCredentials(assignment.client_id);

    if (!credentials.wati) {
      return {
        success: false,
        status: 404,
        message: 'WATI credentials not found for client'
      };
    }

    // Build complete tool configurations (legacy format)
    const watiTools = await Promise.all(
      enabledTools.map(async (assignedTool) => {
        const tool = tools.find(t =>
          t._id.toString() === assignedTool.wati_tool_id.toString()
        );

        if (!tool) return null;

        // Merge parameters (assignment overrides tool)
        const finalParameters = {
          template_id: tool.template_id,
          language: tool.language,
          variables: tool.variables,
          ...assignedTool.parameters_override
        };

        // Merge conditions (assignment overrides tool)
        const finalConditions = assignedTool.conditions_override || tool.conditions;

        // Create HTTP-based MCP config for internal WATI server
        const internalMcpConfig = {
          name: `wati-internal-server`,
          transport: {
            type: 'http',
            path: `/mcp/wati/${agentId}`,
            headers: {
              'Authorization': `Bearer ${process.env.SUPER_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        };

        return {
          wati_tool_id: tool._id.toString(),
          tool_name: tool.tool_name,
          mcp_identifier: 'wati_send_template_message',
          mcp_config: internalMcpConfig,
          template_id: tool.template_id,
          template_name: tool.template_name,
          strategy: tool.strategy,
          conditions: tool.conditions,
          enabled: assignedTool.enabled,
          conditions_override: assignedTool.conditions_override,
          parameters_override: assignedTool.parameters_override,
          final_parameters: finalParameters,
          final_conditions: finalConditions
        };
      })
    );

    // Filter out null values and return legacy format
    const filteredTools = watiTools.filter(tool => tool !== null);

    return {
      success: true,
      status: 200,
      agent_id: agentId,
      client_id: assignment.client_id,
      last_updated: new Date(),
      wati_tools: filteredTools,
      total_tools: filteredTools.length
    };

  } catch (error) {
    console.error('Error getting WATI config for bot:', error);
    return {
      success: false,
      status: 500,
      message: 'Error retrieving WATI configuration',
      error: error.message
    };
  }
}

/**
 * Get WATI MCP configurations for unified bot integration (Standard format)
 */
async function getWatiMcpConfigurations(agentId) {
  try {
    console.log(`🔍 [DEBUG] getWatiMcpConfigurations called for agent ${agentId}`);
    await connectToMongo();
    const db = client.db('glimpass');

    // Get agent assignments
    const assignment = await db.collection('agentWatiTools')
      .findOne({ agent_id: agentId });

    if (!assignment) {
      return {
        success: false,
        status: 404,
        message: 'No WATI tools assigned to agent'
      };
    }

    // Get enabled tools
    const enabledTools = assignment.assigned_tools.filter(tool => tool.enabled);
    const toolIds = enabledTools.map(t => t.wati_tool_id);

    const tools = await db.collection('watiTools')
      .find({ _id: { $in: toolIds } }).toArray();

    // Build MCP configurations in standard Claude format
    const mcpConfigurations = enabledTools.map((assignedTool) => {
      const tool = tools.find(t =>
        t._id.toString() === assignedTool.wati_tool_id.toString()
      );

      if (!tool) return null;

      // Return standard Claude MCP configuration
      return {
        name: `wati-${tool._id.toString()}`,
        transport: {
          type: 'http',
          path: `/mcp/wati/${agentId}`,
          headers: {
            'Authorization': `Bearer ${process.env.SUPER_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      };
    }).filter(config => config !== null);

    return {
      success: true,
      mcp_configurations: mcpConfigurations
    };

  } catch (error) {
    console.error('Error getting WATI MCP configurations:', error);
    return {
      success: false,
      mcp_configurations: []
    };
  }
}

module.exports = {
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
  getWatiConfigForBot,
  getWatiMcpConfigurations
};