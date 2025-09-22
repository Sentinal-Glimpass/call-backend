const { connectToMongo, client } = require('../../../models/mongodb.js');
const { ObjectId } = require('mongodb');

/**
 * Generic MCP Tools Service
 * Handles MCP (Model Context Protocol) server configurations
 */

// =============================================================================
// MCP TOOL MANAGEMENT
// =============================================================================

/**
 * Get all MCP tools for a client
 */
async function getMcpTools(clientId, filters = {}) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const query = { client_id: clientId, ...filters };
    const tools = await db.collection('mcpTools').find(query).toArray();

    return {
      success: true,
      status: 200,
      message: 'MCP tools retrieved successfully',
      data: tools,
      count: tools.length
    };
  } catch (error) {
    console.error('Error fetching MCP tools:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching MCP tools',
      error: error.message
    };
  }
}

/**
 * Validate MCP configuration
 */
function validateMcpConfig(mcpConfig) {
  // Check if it has required fields for MCP server
  if (!mcpConfig.command && !mcpConfig.name) {
    throw new Error('MCP config must have either "command" or "name" field');
  }

  // If it has command, validate command structure
  if (mcpConfig.command) {
    if (typeof mcpConfig.command !== 'string') {
      throw new Error('MCP config "command" must be a string');
    }

    // If args provided, must be array
    if (mcpConfig.args && !Array.isArray(mcpConfig.args)) {
      throw new Error('MCP config "args" must be an array');
    }

    // If env provided, must be object
    if (mcpConfig.env && typeof mcpConfig.env !== 'object') {
      throw new Error('MCP config "env" must be an object');
    }
  }

  // For transport configuration
  if (mcpConfig.transport && typeof mcpConfig.transport !== 'object') {
    throw new Error('MCP config "transport" must be an object');
  }

  return true;
}

/**
 * Test MCP configuration by attempting a basic connection
 */
async function testMcpConfig(mcpConfig) {
  try {
    // For now, we'll do basic validation
    // In production, you might want to actually test the connection
    validateMcpConfig(mcpConfig);

    // Additional checks can be added here:
    // - Test if command exists
    // - Test basic MCP handshake
    // - Validate environment variables

    return { success: true, message: 'MCP configuration is valid' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * Create new MCP tool
 */
async function createMcpTool(toolData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Validate MCP configuration JSON
    if (!toolData.mcp_config) {
      return {
        success: false,
        status: 400,
        message: 'MCP configuration is required'
      };
    }

    // Validate that mcp_config is valid JSON
    let mcpConfig;
    try {
      mcpConfig = typeof toolData.mcp_config === 'string'
        ? JSON.parse(toolData.mcp_config)
        : toolData.mcp_config;
    } catch (e) {
      return {
        success: false,
        status: 400,
        message: 'Invalid MCP configuration JSON'
      };
    }

    // Validate MCP configuration structure
    const configValidation = await testMcpConfig(mcpConfig);
    if (!configValidation.success) {
      return {
        success: false,
        status: 400,
        message: `Invalid MCP configuration: ${configValidation.message}`
      };
    }

    // Check for duplicate tool names
    const existingTool = await db.collection('mcpTools').findOne({
      client_id: toolData.client_id,
      tool_name: toolData.tool_name
    });

    if (existingTool) {
      return {
        success: false,
        status: 400,
        message: 'MCP tool with this name already exists'
      };
    }

    // Prepare tool document
    const mcpTool = {
      client_id: toolData.client_id,
      tool_name: toolData.tool_name,
      description: toolData.description || 'Generic MCP tool',
      mcp_config: mcpConfig,
      mcp_identifier: toolData.mcp_identifier || mcpConfig.name || toolData.tool_name,
      strategy: toolData.strategy || 'immediate',
      conditions: toolData.conditions || [],
      enabled: toolData.enabled !== undefined ? toolData.enabled : true,
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('mcpTools').insertOne(mcpTool);

    return {
      success: true,
      status: 201,
      message: 'MCP tool created successfully',
      data: { ...mcpTool, _id: result.insertedId }
    };
  } catch (error) {
    console.error('Error creating MCP tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error creating MCP tool',
      error: error.message
    };
  }
}

/**
 * Get specific MCP tool by ID
 */
async function getMcpToolById(toolId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const tool = await db.collection('mcpTools')
      .findOne({
        _id: new ObjectId(toolId),
        client_id: clientId
      });

    if (!tool) {
      return {
        success: false,
        status: 404,
        message: 'MCP tool not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'MCP tool retrieved successfully',
      data: tool
    };
  } catch (error) {
    console.error('Error fetching MCP tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching MCP tool',
      error: error.message
    };
  }
}

/**
 * Update MCP tool
 */
async function updateMcpTool(toolId, clientId, updateData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Prepare update document
    const updateDoc = { ...updateData };
    delete updateDoc.client_id; // Don't allow changing client_id
    updateDoc.updated_at = new Date();

    // Validate MCP config if provided
    if (updateDoc.mcp_config) {
      try {
        updateDoc.mcp_config = typeof updateDoc.mcp_config === 'string'
          ? JSON.parse(updateDoc.mcp_config)
          : updateDoc.mcp_config;
      } catch (e) {
        return {
          success: false,
          status: 400,
          message: 'Invalid MCP configuration JSON'
        };
      }
    }

    const result = await db.collection('mcpTools')
      .findOneAndUpdate(
        { _id: new ObjectId(toolId), client_id: clientId },
        { $set: updateDoc },
        { returnDocument: 'after' }
      );

    if (!result) {
      return {
        success: false,
        status: 404,
        message: 'MCP tool not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'MCP tool updated successfully',
      data: result
    };
  } catch (error) {
    console.error('Error updating MCP tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error updating MCP tool',
      error: error.message
    };
  }
}

/**
 * Delete MCP tool
 */
async function deleteMcpTool(toolId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Check if tool is assigned to any agents
    const assignments = await db.collection('agentMcpTools').findOne({
      'assigned_tools.mcp_tool_id': toolId
    });

    if (assignments) {
      return {
        success: false,
        status: 400,
        message: 'Cannot delete MCP tool: it is assigned to agents'
      };
    }

    const result = await db.collection('mcpTools')
      .deleteOne({ _id: new ObjectId(toolId), client_id: clientId });

    if (result.deletedCount === 0) {
      return {
        success: false,
        status: 404,
        message: 'MCP tool not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'MCP tool deleted successfully'
    };
  } catch (error) {
    console.error('Error deleting MCP tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error deleting MCP tool',
      error: error.message
    };
  }
}

// =============================================================================
// AGENT ASSIGNMENTS
// =============================================================================

/**
 * Get agent's MCP tool assignments
 */
async function getAgentMcpTools(agentId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const agentTools = await db.collection('agentMcpTools').findOne({ agent_id: agentId });

    if (!agentTools) {
      return {
        success: true,
        status: 200,
        message: 'No MCP tools assigned to agent',
        data: {
          agent_id: agentId,
          assigned_tools: []
        }
      };
    }

    return {
      success: true,
      status: 200,
      message: 'Agent MCP tools retrieved successfully',
      data: agentTools
    };
  } catch (error) {
    console.error('Error fetching agent MCP tools:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching agent MCP tools',
      error: error.message
    };
  }
}

/**
 * Assign MCP tool to agent
 */
async function assignMcpToolToAgent(agentId, clientId, assignmentData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const { mcp_tool_id, enabled = true, conditions_override, parameters_override } = assignmentData;

    // Verify tool exists
    const tool = await db.collection('mcpTools').findOne({
      _id: new ObjectId(mcp_tool_id),
      client_id: clientId
    });

    if (!tool) {
      return {
        success: false,
        status: 404,
        message: 'MCP tool not found'
      };
    }

    // Check if already assigned
    const existingAssignment = await db.collection('agentMcpTools').findOne({
      agent_id: agentId,
      'assigned_tools.mcp_tool_id': mcp_tool_id
    });

    if (existingAssignment) {
      return {
        success: false,
        status: 400,
        message: 'MCP tool already assigned to agent'
      };
    }

    // Create assignment
    const assignment = {
      mcp_tool_id,
      enabled,
      conditions_override: conditions_override || [],
      parameters_override: parameters_override || {}
    };

    const result = await db.collection('agentMcpTools').findOneAndUpdate(
      { agent_id: agentId },
      {
        $push: { assigned_tools: assignment },
        $set: {
          client_id: clientId,
          updated_at: new Date()
        },
        $setOnInsert: {
          agent_id: agentId,
          created_at: new Date()
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    return {
      success: true,
      status: 200,
      message: 'MCP tool assigned to agent successfully',
      data: result
    };
  } catch (error) {
    console.error('Error assigning MCP tool to agent:', error);
    return {
      success: false,
      status: 500,
      message: 'Error assigning MCP tool to agent',
      error: error.message
    };
  }
}

/**
 * Remove MCP tool from agent
 */
async function removeMcpToolFromAgent(agentId, toolId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const result = await db.collection('agentMcpTools').findOneAndUpdate(
      { agent_id: agentId },
      {
        $pull: { assigned_tools: { mcp_tool_id: toolId } },
        $set: { updated_at: new Date() }
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return {
        success: false,
        status: 404,
        message: 'Agent MCP tool assignment not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'MCP tool removed from agent successfully'
    };
  } catch (error) {
    console.error('Error removing MCP tool from agent:', error);
    return {
      success: false,
      status: 500,
      message: 'Error removing MCP tool from agent',
      error: error.message
    };
  }
}

/**
 * Toggle MCP tool for agent (enable/disable)
 */
async function toggleMcpToolForAgent(agentId, toolId, enabled) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const result = await db.collection('agentMcpTools').findOneAndUpdate(
      {
        agent_id: agentId,
        'assigned_tools.mcp_tool_id': toolId
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
        message: 'Agent MCP tool assignment not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: `MCP tool ${enabled ? 'enabled' : 'disabled'} for agent successfully`
    };
  } catch (error) {
    console.error('Error toggling MCP tool for agent:', error);
    return {
      success: false,
      status: 500,
      message: 'Error toggling MCP tool for agent',
      error: error.message
    };
  }
}

// =============================================================================
// BOT INTEGRATION
// =============================================================================

/**
 * Get complete MCP configuration for bot integration
 * Aggregates all tool types: WATI, Gmail, and generic MCP tools
 */
async function getMcpConfigForBot(agentId) {
  try {
    console.log(`🔍 [DEBUG] getMcpConfigForBot called for agent ${agentId}`);
    const allMcpConfigurations = [];

    // Import services for in-house tools
    const { getWatiMcpConfigurations } = require('./watiService');
    const { getEmailMcpConfigurations } = require('./emailService');

    // 1. Get WATI tool configurations
    try {
      const watiResult = await getWatiMcpConfigurations(agentId);
      if (watiResult.success && watiResult.mcp_configurations) {
        allMcpConfigurations.push(...watiResult.mcp_configurations);
      }
    } catch (error) {
      console.log(`No WATI tools for agent ${agentId}: ${error.message}`);
    }

    // 2. Get Gmail tool configurations
    try {
      const emailResult = await getEmailMcpConfigurations(agentId);
      if (emailResult.success && emailResult.mcp_configurations) {
        allMcpConfigurations.push(...emailResult.mcp_configurations);
      }
    } catch (error) {
      console.log(`No Gmail tools for agent ${agentId}: ${error.message}`);
    }

    // 3. Get generic MCP tool configurations
    try {
      await connectToMongo();
      const db = client.db('glimpass');

      const agentTools = await db.collection('agentMcpTools').findOne({ agent_id: agentId });

      if (agentTools && agentTools.assigned_tools.length > 0) {
        // Get details for each assigned generic MCP tool
        for (const assignment of agentTools.assigned_tools) {
          if (!assignment.enabled) continue;

          const tool = await db.collection('mcpTools').findOne({
            _id: new ObjectId(assignment.mcp_tool_id)
          });

          if (tool) {
            // For generic MCP tools, use the user-provided config directly
            const finalConfig = {
              ...tool.mcp_config,
              ...assignment.parameters_override
            };

            allMcpConfigurations.push(finalConfig);
          }
        }
      }
    } catch (error) {
      console.log(`No generic MCP tools for agent ${agentId}: ${error.message}`);
    }

    // Return unified list of MCP configurations
    if (allMcpConfigurations.length === 0) {
      return {
        success: false,
        status: 404,
        message: 'No tools assigned to agent'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'MCP configurations retrieved successfully',
      mcp_configurations: allMcpConfigurations
    };
  } catch (error) {
    console.error('Error getting MCP config for bot:', error);
    return {
      success: false,
      status: 500,
      message: 'Error getting MCP config for bot',
      error: error.message
    };
  }
}

module.exports = {
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
  getMcpConfigForBot,

  // Validation
  validateMcpConfig,
  testMcpConfig
};