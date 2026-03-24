const { connectToMongo, client } = require('../../../models/mongodb.js');
const { ObjectId } = require('mongodb');

/**
 * Schedule Call Tool Service
 *
 * Manages schedule call tool configurations and scheduled call instances:
 * - Schedule call tool definitions (scheduleCallTools collection)
 * - Agent assignments (agentScheduleCallTools collection)
 * - Scheduled call instances (scheduledCalls collection)
 * - Bot integration for MCP
 */

// =============================================================================
// HELPER: Parse delay string to milliseconds
// =============================================================================

function parseDelay(delayStr) {
  if (!delayStr || typeof delayStr !== 'string') return null;

  const match = delayStr.trim().match(/^(\d+)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|d|days?)$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (unit.startsWith('h')) return value * 60 * 60 * 1000;
  if (unit.startsWith('m')) return value * 60 * 1000;
  if (unit.startsWith('d')) return value * 24 * 60 * 60 * 1000;
  return null;
}

// =============================================================================
// SCHEDULE CALL TOOL INSTANCES MANAGEMENT
// =============================================================================

async function getScheduleCallTools(clientId, filters = {}) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const query = { client_id: clientId, ...filters };
    const tools = await db.collection('scheduleCallTools').find(query).toArray();

    return {
      success: true,
      status: 200,
      message: 'Schedule call tools retrieved successfully',
      data: tools,
      count: tools.length
    };
  } catch (error) {
    console.error('Error fetching schedule call tools:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching schedule call tools',
      error: error.message
    };
  }
}

async function createScheduleCallTool(toolData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const existingTool = await db.collection('scheduleCallTools')
      .findOne({
        client_id: toolData.client_id,
        tool_name: toolData.tool_name
      });

    if (existingTool) {
      return {
        success: false,
        status: 400,
        message: `Schedule call tool '${toolData.tool_name}' already exists for this client`
      };
    }

    if (!toolData.tool_name || !toolData.target_agent_id || !toolData.from_number) {
      return {
        success: false,
        status: 400,
        message: 'tool_name, target_agent_id, and from_number are required'
      };
    }

    const tool = {
      client_id: toolData.client_id,
      tool_name: toolData.tool_name,
      description: toolData.description || 'Schedule a follow-up call',
      target_agent_id: toolData.target_agent_id,
      from_number: toolData.from_number,
      default_delay: toolData.default_delay || '24h',
      enabled: toolData.enabled !== undefined ? toolData.enabled : true,
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('scheduleCallTools').insertOne(tool);

    return {
      success: true,
      status: 201,
      message: 'Schedule call tool created successfully',
      data: { _id: result.insertedId, ...tool }
    };
  } catch (error) {
    console.error('Error creating schedule call tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error creating schedule call tool',
      error: error.message
    };
  }
}

async function getScheduleCallToolById(toolId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const tool = await db.collection('scheduleCallTools')
      .findOne({
        _id: new ObjectId(toolId),
        client_id: clientId
      });

    if (!tool) {
      return { success: false, status: 404, message: 'Schedule call tool not found' };
    }

    return { success: true, status: 200, data: tool };
  } catch (error) {
    console.error('Error fetching schedule call tool:', error);
    return { success: false, status: 500, message: 'Error fetching schedule call tool', error: error.message };
  }
}

async function updateScheduleCallTool(toolId, clientId, updateData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const result = await db.collection('scheduleCallTools')
      .findOneAndUpdate(
        { _id: new ObjectId(toolId), client_id: clientId },
        { $set: { ...updateData, updated_at: new Date() } },
        { returnDocument: 'after' }
      );

    if (!result) {
      return { success: false, status: 404, message: 'Schedule call tool not found' };
    }

    return { success: true, status: 200, message: 'Schedule call tool updated successfully', data: result };
  } catch (error) {
    console.error('Error updating schedule call tool:', error);
    return { success: false, status: 500, message: 'Error updating schedule call tool', error: error.message };
  }
}

async function deleteScheduleCallTool(toolId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const assignmentCount = await db.collection('agentScheduleCallTools')
      .countDocuments({ 'assigned_tools.schedule_call_tool_id': new ObjectId(toolId) });

    if (assignmentCount > 0) {
      return {
        success: false,
        status: 400,
        message: `Cannot delete. Tool is assigned to ${assignmentCount} agents.`
      };
    }

    const result = await db.collection('scheduleCallTools')
      .deleteOne({ _id: new ObjectId(toolId), client_id: clientId });

    if (result.deletedCount === 0) {
      return { success: false, status: 404, message: 'Schedule call tool not found' };
    }

    return { success: true, status: 200, message: 'Schedule call tool deleted successfully' };
  } catch (error) {
    console.error('Error deleting schedule call tool:', error);
    return { success: false, status: 500, message: 'Error deleting schedule call tool', error: error.message };
  }
}

// =============================================================================
// AGENT ASSIGNMENTS
// =============================================================================

async function getAgentScheduleCallTools(agentId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const assignment = await db.collection('agentScheduleCallTools')
      .findOne({ agent_id: agentId });

    if (!assignment) {
      return {
        success: true,
        status: 200,
        message: 'No schedule call tools assigned to agent',
        data: { agent_id: agentId, assigned_tools: [] }
      };
    }

    const enrichedTools = await Promise.all(
      assignment.assigned_tools.map(async (assignedTool) => {
        const tool = await db.collection('scheduleCallTools')
          .findOne({ _id: assignedTool.schedule_call_tool_id });
        return { ...assignedTool, tool_details: tool };
      })
    );

    return {
      success: true,
      status: 200,
      message: 'Agent schedule call tools retrieved successfully',
      data: { ...assignment, assigned_tools: enrichedTools }
    };
  } catch (error) {
    console.error('Error fetching agent schedule call tools:', error);
    return { success: false, status: 500, message: 'Error fetching agent schedule call tools', error: error.message };
  }
}

async function assignScheduleCallToolToAgent(agentId, clientId, assignmentData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const toolId = assignmentData.schedule_call_tool_id || assignmentData.toolId || assignmentData.tool_id;
    if (!toolId) {
      return { success: false, status: 400, message: 'schedule_call_tool_id or toolId is required' };
    }

    const tool = await db.collection('scheduleCallTools')
      .findOne({ _id: new ObjectId(toolId), client_id: clientId });

    if (!tool) {
      return { success: false, status: 404, message: 'Schedule call tool not found or does not belong to client' };
    }

    const assignment = {
      schedule_call_tool_id: new ObjectId(toolId),
      enabled: assignmentData.enabled !== undefined ? assignmentData.enabled : true
    };

    const existingAssignment = await db.collection('agentScheduleCallTools')
      .findOne({
        agent_id: agentId,
        'assigned_tools.schedule_call_tool_id': assignment.schedule_call_tool_id
      });

    if (existingAssignment) {
      return { success: false, status: 400, message: 'Schedule call tool already assigned to agent' };
    }

    const result = await db.collection('agentScheduleCallTools')
      .findOneAndUpdate(
        { agent_id: agentId },
        {
          $push: { assigned_tools: assignment },
          $setOnInsert: { agent_id: agentId, client_id: clientId, created_at: new Date() },
          $set: { updated_at: new Date() }
        },
        { upsert: true, returnDocument: 'after' }
      );

    return { success: true, status: 200, message: 'Schedule call tool assigned to agent successfully', data: result };
  } catch (error) {
    console.error('Error assigning schedule call tool to agent:', error);
    return { success: false, status: 500, message: 'Error assigning schedule call tool to agent', error: error.message };
  }
}

async function removeScheduleCallToolFromAgent(agentId, toolId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const result = await db.collection('agentScheduleCallTools')
      .findOneAndUpdate(
        { agent_id: agentId },
        {
          $pull: { assigned_tools: { schedule_call_tool_id: new ObjectId(toolId) } },
          $set: { updated_at: new Date() }
        },
        { returnDocument: 'after' }
      );

    if (!result) {
      return { success: false, status: 404, message: 'Agent assignment not found' };
    }

    return { success: true, status: 200, message: 'Schedule call tool removed from agent successfully' };
  } catch (error) {
    console.error('Error removing schedule call tool from agent:', error);
    return { success: false, status: 500, message: 'Error removing schedule call tool from agent', error: error.message };
  }
}

async function toggleScheduleCallToolForAgent(agentId, toolId, enabled) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const result = await db.collection('agentScheduleCallTools')
      .findOneAndUpdate(
        { agent_id: agentId, 'assigned_tools.schedule_call_tool_id': new ObjectId(toolId) },
        { $set: { 'assigned_tools.$.enabled': enabled, updated_at: new Date() } },
        { returnDocument: 'after' }
      );

    if (!result) {
      return { success: false, status: 404, message: 'Schedule call tool assignment not found' };
    }

    return { success: true, status: 200, message: `Schedule call tool ${enabled ? 'enabled' : 'disabled'} for agent` };
  } catch (error) {
    console.error('Error toggling schedule call tool:', error);
    return { success: false, status: 500, message: 'Error toggling schedule call tool', error: error.message };
  }
}

// =============================================================================
// SCHEDULED CALLS (Instances)
// =============================================================================

async function createScheduledCall(data) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const delayMs = parseDelay(data.delay);
    if (!delayMs) {
      return { success: false, status: 400, message: `Invalid delay format: '${data.delay}'. Use e.g. '24h', '2h', '30m', '1d'` };
    }

    const scheduledCall = {
      clientId: data.clientId,
      targetAgentId: data.targetAgentId,
      fromNumber: data.fromNumber,
      toNumber: data.toNumber,
      context: data.context || '',
      delay: data.delay,
      executeAt: new Date(Date.now() + delayMs),
      status: 'pending',
      scheduledByAgentId: data.scheduledByAgentId || null,
      scheduledByCallUUID: data.scheduledByCallUUID || null,
      createdAt: new Date()
    };

    const result = await db.collection('scheduledCalls').insertOne(scheduledCall);

    return {
      success: true,
      status: 201,
      message: 'Call scheduled successfully',
      data: { _id: result.insertedId, ...scheduledCall }
    };
  } catch (error) {
    console.error('Error creating scheduled call:', error);
    return { success: false, status: 500, message: 'Error creating scheduled call', error: error.message };
  }
}

async function getPendingScheduledCalls(limit = 20) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const calls = await db.collection('scheduledCalls')
      .find({ status: 'pending', executeAt: { $lte: new Date() } })
      .sort({ executeAt: 1 })
      .limit(limit)
      .toArray();

    return { success: true, data: calls };
  } catch (error) {
    console.error('Error fetching pending scheduled calls:', error);
    return { success: false, data: [] };
  }
}

async function updateScheduledCallStatus(callId, status, metadata = {}) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    await db.collection('scheduledCalls')
      .updateOne(
        { _id: new ObjectId(callId) },
        { $set: { status, ...metadata, updatedAt: new Date() } }
      );

    return { success: true };
  } catch (error) {
    console.error('Error updating scheduled call status:', error);
    return { success: false };
  }
}

// =============================================================================
// BOT INTEGRATION
// =============================================================================

async function getScheduleCallConfigForBot(agentId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const assignment = await db.collection('agentScheduleCallTools')
      .findOne({ agent_id: agentId });

    if (!assignment) {
      return { success: false, status: 404, message: 'No schedule call tools assigned to agent' };
    }

    const enabledTools = assignment.assigned_tools.filter(t => t.enabled);
    const toolIds = enabledTools.map(t => t.schedule_call_tool_id);

    const tools = await db.collection('scheduleCallTools')
      .find({ _id: { $in: toolIds } }).toArray();

    const scheduleCallTools = enabledTools.map(assignedTool => {
      const tool = tools.find(t => t._id.toString() === assignedTool.schedule_call_tool_id.toString());
      if (!tool) return null;

      return {
        schedule_call_tool_id: tool._id.toString(),
        tool_name: tool.tool_name,
        description: tool.description,
        target_agent_id: tool.target_agent_id,
        from_number: tool.from_number,
        default_delay: tool.default_delay,
        mcp_identifier: 'schedule_call',
        mcp_config: {
          name: 'schedule-call-internal-server',
          transport: {
            type: 'http',
            path: `/mcp/schedule-call/${agentId}`,
            headers: {
              'Authorization': `Bearer ${process.env.SUPER_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        },
        strategy: 'immediate',
        enabled: assignedTool.enabled
      };
    }).filter(t => t !== null);

    return {
      success: true,
      status: 200,
      agent_id: agentId,
      client_id: assignment.client_id,
      schedule_call_tools: scheduleCallTools,
      total_tools: scheduleCallTools.length
    };
  } catch (error) {
    console.error('Error getting schedule call config for bot:', error);
    return { success: false, status: 500, message: 'Error retrieving schedule call configuration', error: error.message };
  }
}

module.exports = {
  parseDelay,
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
  getPendingScheduledCalls,
  updateScheduledCallStatus,
  getScheduleCallConfigForBot
};
