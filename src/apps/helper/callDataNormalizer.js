/**
 * Call Data Normalizer
 *
 * Normalizes call data from different providers (Plivo, Twilio) into a clean,
 * provider-agnostic format for storage and API responses.
 */

/**
 * Normalize Plivo hangup webhook data into clean format
 * @param {Object} plivoData - Raw Plivo webhook data
 * @param {Object} metadata - Additional metadata (clientId, campId, tag, etc.)
 * @returns {Object} Normalized call data
 */
function normalizePlivoHangup(plivoData, metadata = {}) {
  const {
    // Core identifiers (Plivo sends multiple redundant UUIDs)
    CallUUID,

    // Call details
    To,
    From,
    Duration,
    CallStatus,
    HangupCause,

    // Timestamps
    StartTime,
    AnswerTime,
    EndTime,

    // Recording (may come from webhook or be added later)
    RecordUrl
  } = plivoData;

  return {
    // Core identifiers
    callUUID: CallUUID,
    clientId: metadata.clientId?.toString() || null,
    assistantId: metadata.tag || metadata.assistantId || null,

    // Call details
    to: To,
    from: From,
    duration: parseInt(Duration) || 0,
    status: normalizeStatus(CallStatus),
    hangupCause: HangupCause,

    // Timestamps (convert to ISO format if possible)
    startTime: StartTime,
    answerTime: AnswerTime,
    endTime: EndTime,

    // Recording
    recordingUrl: RecordUrl || null,

    // Source tracking
    source: normalizeSource(metadata.campId),
    provider: 'plivo',

    // Contact info from metadata
    firstName: metadata.firstName || '',
    email: metadata.email || '',
    tag: metadata.customTag || '',

    // Campaign reference (for campaign calls)
    campaignId: metadata.campId && !['api-call', 'testcall', 'incoming'].includes(metadata.campId)
      ? metadata.campId : null,

    // Timestamps
    createdAt: new Date()
  };
}

/**
 * Normalize Twilio hangup webhook data into clean format
 * @param {Object} twilioData - Raw Twilio webhook data (may have CallUUID override)
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Normalized call data
 */
function normalizeTwilioHangup(twilioData, metadata = {}) {
  const {
    CallSid,
    CallUUID, // Our internal UUID (may override CallSid)
    To,
    From,
    Duration, // May be mapped from CallDuration
    CallDuration,
    CallStatus,
    RecordingUrl,
    RecordUrl, // May be mapped from RecordingUrl
    Timestamp,
    SipResponseCode
  } = twilioData;

  // Use our internal CallUUID if provided, otherwise use Twilio's CallSid
  const finalCallUUID = CallUUID || CallSid;

  // Use Duration (which may be mapped from CallDuration) or CallDuration directly
  const durationValue = parseInt(Duration) || parseInt(CallDuration) || 0;

  // Sanitize phone numbers (remove + prefix for consistency)
  const sanitizedTo = To?.replace(/^\+/, '') || '';
  const sanitizedFrom = From?.replace(/^\+/, '') || '';

  return {
    // Core identifiers
    callUUID: finalCallUUID,
    clientId: metadata.clientId?.toString() || null,
    assistantId: metadata.tag || metadata.assistantId || null,

    // Call details
    to: sanitizedTo,
    from: sanitizedFrom,
    duration: durationValue,
    status: normalizeStatus(CallStatus),
    hangupCause: mapTwilioStatusToHangupCause(CallStatus, SipResponseCode),

    // Timestamps
    startTime: metadata.startTime || null,
    answerTime: metadata.answerTime || null,
    endTime: Timestamp || new Date().toISOString(),

    // Recording
    recordingUrl: RecordUrl || RecordingUrl || null,

    // Source tracking
    source: normalizeSource(metadata.campId),
    provider: 'twilio',

    // Contact info
    firstName: metadata.firstName || '',
    email: metadata.email || '',
    tag: metadata.customTag || '',

    // Campaign reference
    campaignId: metadata.campId && !['api-call', 'testcall', 'incoming'].includes(metadata.campId)
      ? metadata.campId : null,

    createdAt: new Date()
  };
}

/**
 * Normalize bot callback data to merge with hangup record
 * @param {Object} botData - Raw bot callback data
 * @returns {Object} Normalized bot data for merging
 */
function normalizeBotCallback(botData) {
  const {
    messages,
    chat,
    lead_analysis,
    summary,
    structuredOutputData,
    conversation_time
  } = botData;

  const normalized = {
    botDataMergedAt: new Date()
  };

  // Messages array (preferred format)
  if (messages && Array.isArray(messages) && messages.length > 0) {
    normalized.messages = messages;
  }

  // Lead analysis
  if (lead_analysis && typeof lead_analysis === 'object') {
    normalized.leadAnalysis = {
      isLead: lead_analysis.is_lead === 'true' || lead_analysis.is_lead === true,
      reason: lead_analysis.reason || '',
      nextAction: lead_analysis.next_action || ''
    };
  }

  // Call summary
  if (summary && summary !== 'summary') {
    normalized.callSummary = summary;
  }

  // Structured output (parse if string)
  if (structuredOutputData) {
    try {
      const parsed = typeof structuredOutputData === 'string'
        ? JSON.parse(structuredOutputData)
        : structuredOutputData;

      normalized.structuredAnalysis = {
        hotLead: parsed.hotLead || 0,
        warmLead: parsed.warmLead || 0,
        coldLead: parsed.coldLead || 0,
        explanation: parsed.explanation || '',
        detailedSummary: parsed.detailedSummary || '',
        problem: parsed.problem || '',
        name: parsed.name || ''
      };
    } catch (e) {
      // Keep as string if parsing fails
      normalized.structuredAnalysis = structuredOutputData;
    }
  }

  // Conversation duration from bot
  if (conversation_time) {
    normalized.conversationDuration = Math.round(conversation_time);
  }

  return normalized;
}

/**
 * Normalize call status across providers
 */
function normalizeStatus(status) {
  if (!status) return 'unknown';

  const statusLower = status.toLowerCase();

  // Map to standard statuses
  const statusMap = {
    'completed': 'completed',
    'answered': 'completed',
    'busy': 'busy',
    'no-answer': 'no-answer',
    'noanswer': 'no-answer',
    'failed': 'failed',
    'canceled': 'canceled',
    'cancelled': 'canceled',
    'ringing': 'ringing',
    'in-progress': 'in-progress'
  };

  return statusMap[statusLower] || status;
}

/**
 * Normalize source type from campId
 */
function normalizeSource(campId) {
  if (!campId) return 'unknown';
  if (campId === 'api-call') return 'api';
  if (campId === 'testcall') return 'test';
  if (campId === 'incoming') return 'inbound';
  return 'campaign';
}

/**
 * Map Twilio status to hangup cause
 */
function mapTwilioStatusToHangupCause(status, sipResponseCode) {
  // If SIP response code is provided and is 200, it's normal clearing
  if (sipResponseCode === '200') {
    return 'NORMAL_CLEARING';
  }

  const causeMap = {
    'completed': 'NORMAL_CLEARING',
    'busy': 'USER_BUSY',
    'no-answer': 'NO_ANSWER',
    'failed': 'CALL_REJECTED',
    'canceled': 'ORIGINATOR_CANCEL'
  };
  return causeMap[status?.toLowerCase()] || 'UNKNOWN';
}

/**
 * Create clean API response from stored call data
 * Works with both old (raw) and new (normalized) data formats
 * @param {Object} callData - Stored call data (from plivoHangupData)
 * @param {Object} logData - Optional log data (from logData collection)
 * @returns {Object} Clean API response
 */
function createApiResponse(callData, logData = {}) {
  // Handle both old and new field names
  const response = {
    callUUID: callData.callUUID || callData.CallUUID,
    to: callData.to || callData.To,
    from: callData.from || callData.From,
    duration: callData.duration ?? parseInt(callData.Duration) ?? 0,
    status: callData.status || normalizeStatus(callData.CallStatus || callData.Status),
    hangupCause: callData.hangupCause || callData.HangupCause,
    startTime: callData.startTime || callData.StartTime,
    endTime: callData.endTime || callData.EndTime,
    answerTime: callData.answerTime || callData.AnswerTime
  };

  // Add optional fields only if they have values
  const recordingUrl = callData.recordingUrl || callData.RecordUrl;
  if (recordingUrl) response.recordingUrl = recordingUrl;

  // Messages/transcript
  const messages = callData.messages || logData.messages || logData.transcript || logData.conversationLog;
  if (messages && Array.isArray(messages) && messages.length > 0) {
    response.transcript = messages;
  }

  // Lead analysis (handle both formats)
  const leadAnalysis = callData.leadAnalysis || callData.lead_analysis || logData.leadAnalysis || logData.lead_analysis;
  if (leadAnalysis) {
    response.leadAnalysis = leadAnalysis;
  }

  // Call summary
  const summary = callData.callSummary || callData.summary || logData.callSummary || logData.summary;
  if (summary && summary !== 'summary') {
    response.callSummary = summary;
  }

  // Structured analysis
  const structuredAnalysis = callData.structuredAnalysis || callData.structuredOutputData;
  if (structuredAnalysis) {
    response.structuredAnalysis = typeof structuredAnalysis === 'string'
      ? JSON.parse(structuredAnalysis)
      : structuredAnalysis;
  }

  // Contact info
  if (callData.firstName || logData.firstName) response.firstName = callData.firstName || logData.firstName;
  if (callData.email || logData.email) response.email = callData.email || logData.email;
  if (callData.tag) response.tag = callData.tag;
  if (callData.assistantId || callData.agent_id) response.assistantId = callData.assistantId || callData.agent_id;

  return response;
}

module.exports = {
  normalizePlivoHangup,
  normalizeTwilioHangup,
  normalizeBotCallback,
  normalizeStatus,
  normalizeSource,
  createApiResponse
};
