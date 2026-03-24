const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');
const axios = require('axios');

/**
 * Post-Call Action Runner
 *
 * Executes post-call actions configured on an assistant after a call completes.
 * Actions are defined in assistant.post_call_actions array.
 *
 * Action types:
 * - webhook: POST report data to an external URL
 * - whatsapp: Send WhatsApp message via assigned WATI tool
 * - email: Send email via assigned Gmail tool
 * - schedule_call: Schedule a follow-up call
 *
 * Each action has a condition that is evaluated against the report.
 * Conditions: "always", "column == 'value'", "column != 'value'"
 */

// =============================================================================
// CONDITION EVALUATOR
// =============================================================================

function evaluateCondition(condition, report) {
  if (!condition || condition === 'always') return true;

  // Parse "column == 'value'" or "column != 'value'"
  const eqMatch = condition.match(/^(\w+)\s*==\s*['"](.+)['"]$/);
  if (eqMatch) {
    const [, column, value] = eqMatch;
    return String(report[column] || '').toLowerCase() === value.toLowerCase();
  }

  const neqMatch = condition.match(/^(\w+)\s*!=\s*['"](.+)['"]$/);
  if (neqMatch) {
    const [, column, value] = neqMatch;
    return String(report[column] || '').toLowerCase() !== value.toLowerCase();
  }

  // If condition can't be parsed, default to true
  console.warn(`⚠️ Post-call action: Could not parse condition "${condition}", defaulting to true`);
  return true;
}

// =============================================================================
// REPORT BUILDER
// =============================================================================

function buildReport(mergedRecord, assistantDoc) {
  const report = {};

  // Default columns from call data
  report.callUUID = mergedRecord.callUUID || mergedRecord.CallUUID || '';
  report.to = mergedRecord.to || mergedRecord.To || '';
  report.from = mergedRecord.from || mergedRecord.From || '';
  report.duration = mergedRecord.duration || mergedRecord.Duration || '';
  report.status = mergedRecord.callStatus || mergedRecord.Status || '';
  report.summary = mergedRecord.summary || '';
  report.recordingUrl = mergedRecord.recordingUrl || mergedRecord.RecordUrl || '';
  report.transcript = mergedRecord.chat_history || '';

  // Lead analysis columns from bot data
  if (mergedRecord.lead_analysis) {
    const analysis = typeof mergedRecord.lead_analysis === 'string'
      ? JSON.parse(mergedRecord.lead_analysis)
      : mergedRecord.lead_analysis;

    Object.entries(analysis).forEach(([key, value]) => {
      report[key] = value;
    });
  }

  return report;
}

// =============================================================================
// ACTION EXECUTORS
// =============================================================================

async function executeWebhook(action, report) {
  const { url, method, headers, api_key } = action.config || {};

  if (!url) throw new Error('Webhook URL is required');

  const requestHeaders = { 'Content-Type': 'application/json' };

  // Add custom headers
  if (headers && typeof headers === 'object') {
    Object.entries(headers).forEach(([key, value]) => {
      requestHeaders[key] = value;
    });
  }

  // Add API key header if provided
  if (api_key) {
    requestHeaders['Authorization'] = `Bearer ${api_key}`;
  }

  // Map report columns to body if column_mapping exists, otherwise send full report
  let body = report;
  if (action.config.column_mapping && typeof action.config.column_mapping === 'object') {
    body = {};
    Object.entries(action.config.column_mapping).forEach(([bodyKey, reportColumn]) => {
      body[bodyKey] = report[reportColumn] || '';
    });
  }

  const response = await axios({
    method: method || 'POST',
    url,
    headers: requestHeaders,
    data: body,
    timeout: 10000
  });

  return { status: response.status, data: response.data };
}

async function executeWhatsApp(action, report) {
  const { tool_id, recipient_column, template_variable_mapping } = action.config || {};

  if (!tool_id || !recipient_column) {
    throw new Error('WhatsApp action requires tool_id and recipient_column');
  }

  const recipient = report[recipient_column];
  if (!recipient) {
    throw new Error(`Recipient column "${recipient_column}" is empty in report`);
  }

  // Build MCP request to WATI server
  const args = { recipient };

  // Map template variables from report columns
  if (template_variable_mapping && typeof template_variable_mapping === 'object') {
    Object.entries(template_variable_mapping).forEach(([templateVar, reportColumn]) => {
      args[templateVar] = report[reportColumn] || '';
    });
  }

  const baseURL = process.env.INTERNAL_API_BASE_URL || 'http://localhost:7999';
  const response = await axios.post(
    `${baseURL}/mcp/wati/${action.agent_id}`,
    {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: 'whatsapp_messenger', arguments: args }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPER_KEY}`
      },
      timeout: 15000
    }
  );

  return response.data;
}

async function executeEmail(action, report) {
  const { tool_id, recipient_column, subject_template, body_template } = action.config || {};

  if (!tool_id || !recipient_column) {
    throw new Error('Email action requires tool_id and recipient_column');
  }

  const recipient = report[recipient_column];
  if (!recipient) {
    throw new Error(`Recipient column "${recipient_column}" is empty in report`);
  }

  // Replace {{column}} placeholders in subject and body
  let subject = subject_template || 'Call Report';
  let body = body_template || JSON.stringify(report, null, 2);

  Object.entries(report).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    subject = subject.replace(regex, String(value));
    body = body.replace(regex, String(value));
  });

  const baseURL = process.env.INTERNAL_API_BASE_URL || 'http://localhost:7999';
  const response = await axios.post(
    `${baseURL}/mcp/gmail/${action.agent_id}`,
    {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: 'send_email', arguments: { recipient, subject, body } }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPER_KEY}`
      },
      timeout: 15000
    }
  );

  return response.data;
}

async function executeScheduleCall(action, report) {
  const { target_agent_id, delay, context_columns } = action.config || {};

  if (!target_agent_id) {
    throw new Error('Schedule call action requires target_agent_id');
  }

  const toNumber = report.to || '';
  if (!toNumber) {
    throw new Error('No phone number (to) found in report');
  }

  // Build context from specified columns
  let context = '';
  if (context_columns && Array.isArray(context_columns)) {
    const contextParts = context_columns
      .filter(col => report[col])
      .map(col => `${col}: ${report[col]}`);
    context = contextParts.join('. ');
  }

  const { createScheduledCall } = require('./tools/scheduleCallService');
  const result = await createScheduledCall({
    clientId: report._clientId,
    targetAgentId: target_agent_id,
    fromNumber: report.from || '',
    toNumber,
    delay: delay || '24h',
    context,
    scheduledByAgentId: action.agent_id || null,
    scheduledByCallUUID: report.callUUID || null
  });

  return result;
}

// =============================================================================
// MAIN RUNNER
// =============================================================================

async function runPostCallActions(mergedRecord, assistantId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Get assistant doc to read post_call_actions
    const assistant = await db.collection('assistants').findOne({ _id: new ObjectId(assistantId) });

    if (!assistant || !assistant.post_call_actions || assistant.post_call_actions.length === 0) {
      return; // No post-call actions configured
    }

    const report = buildReport(mergedRecord, assistant);
    report._clientId = assistant.clientId; // Attach for schedule_call

    console.log(`🔄 Running ${assistant.post_call_actions.length} post-call action(s) for call ${report.callUUID}`);

    const results = await Promise.allSettled(
      assistant.post_call_actions.map(async (action, index) => {
        try {
          // Evaluate condition
          if (!evaluateCondition(action.condition, report)) {
            console.log(`   ⏭️ Action #${index + 1} (${action.type}) skipped - condition not met: "${action.condition}"`);
            return { skipped: true, type: action.type };
          }

          // Attach agent_id for MCP-based actions
          action.agent_id = assistantId;

          let result;
          switch (action.type) {
            case 'webhook':
              result = await executeWebhook(action, report);
              break;
            case 'whatsapp':
              result = await executeWhatsApp(action, report);
              break;
            case 'email':
              result = await executeEmail(action, report);
              break;
            case 'schedule_call':
              result = await executeScheduleCall(action, report);
              break;
            default:
              throw new Error(`Unknown action type: ${action.type}`);
          }

          console.log(`   ✅ Action #${index + 1} (${action.type}) completed`);
          return { success: true, type: action.type, result };
        } catch (actionError) {
          console.error(`   ❌ Action #${index + 1} (${action.type}) failed:`, actionError.message);
          return { success: false, type: action.type, error: actionError.message };
        }
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
    const skipped = results.filter(r => r.status === 'fulfilled' && r.value?.skipped).length;
    const failed = results.length - succeeded - skipped;

    console.log(`🔄 Post-call actions complete: ${succeeded} succeeded, ${skipped} skipped, ${failed} failed`);
  } catch (error) {
    console.error('❌ Error running post-call actions:', error.message);
  }
}

module.exports = { runPostCallActions, evaluateCondition, buildReport };
