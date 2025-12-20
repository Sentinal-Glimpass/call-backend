/**
 * Twilio to Plivo Data Mapping Adapter
 * Transforms Twilio webhook data to match exact Plivo format for frontend compatibility
 */

/**
 * Maps Twilio hangup data to Plivo hangup format
 * @param {Object} twilioData - Raw Twilio webhook data
 * @param {Object} callRecord - Call record from database
 * @returns {Object} Plivo-formatted hangup data
 */
function mapTwilioHangupToPlivoFormat(twilioData, callRecord) {
  const { 
    CallSid, From, To, Duration, CallDuration, SipResponseCode,
    RecordingUrl, // Recording URL from status callback
    // Additional Twilio fields for future use
    CallerCountry, CalledCountry, CallerState, CalledState, 
    CallerCity, CalledCity, ToCountry, ToState, ToCity,
    FromCountry, FromState, FromCity
  } = twilioData;
  
  const ourCallUUID = callRecord.callUUID;
  const clientId = callRecord.clientId?.toString() || null;
  const campId = callRecord.campaignId === 'testcall' ? 'testcall' : (callRecord.campaignId?.toString() || 'incoming');
  
  // Use CallDuration (total call duration) instead of Duration (answered duration)
  const callDurationSeconds = parseInt(CallDuration) || 0;
  const answerDurationSeconds = parseInt(Duration) || 0;
  
  // Helper function to convert UTC timestamp to IST (Indian Standard Time: UTC+5:30)
  const convertToIST = (utcTimestamp) => {
    if (!utcTimestamp) return null;
    
    // Parse UTC timestamp from Twilio (format: "Sat, 30 Aug 2025 22:01:43 +0000")
    const utcDate = new Date(utcTimestamp);
    
    // Add 5 hours 30 minutes for IST
    const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
    
    // Format as Plivo format: "2025-08-30 22:01:43"
    return istDate.toISOString().replace('T', ' ').substring(0, 19);
  };
  
  // Generate timestamps in Plivo format (IST timezone)
  // Twilio timestamps are in UTC, we need to extract them from the webhook data
  const now = new Date();
  const nowIST = convertToIST(now.toUTCString());
  
  // Calculate approximate start and answer times based on durations
  const endTime = nowIST;
  const startTime = convertToIST(new Date(now.getTime() - callDurationSeconds * 1000).toUTCString());
  const answerTime = convertToIST(new Date(now.getTime() - answerDurationSeconds * 1000).toUTCString());
  
  // Sanitize phone numbers (remove + prefix)
  const sanitizedFrom = From?.replace(/^\+/, '') || '';
  const sanitizedTo = To?.replace(/^\+/, '') || '';
  
  return {
    // Plivo-specific UUID fields (all should be the same)
    CallUUID: ourCallUUID,
    ALegUUID: ourCallUUID,
    ALegRequestUUID: ourCallUUID,
    RequestUUID: ourCallUUID,
    
    // Call details in Plivo format
    From: sanitizedFrom,
    To: sanitizedTo,
    Direction: "outbound",
    CallStatus: "completed",
    
    // Timing fields in Plivo format
    StartTime: startTime,
    AnswerTime: answerTime,
    EndTime: endTime,
    Duration: callDurationSeconds.toString(), // Use CallDuration as main duration
    BillDuration: callDurationSeconds.toString(), // Use CallDuration for billing
    
    // Hangup details in Plivo format
    Event: "Hangup",
    HangupCause: SipResponseCode === '200' ? 'NORMAL_CLEARING' : 'CALL_REJECTED',
    HangupCauseCode: SipResponseCode || '200',
    HangupCauseName: SipResponseCode === '200' ? 'Normal Hangup' : 'Call Rejected',
    HangupSource: SipResponseCode === '200' ? 'Callee' : 'Network',
    
    // Plivo account fields (use placeholders for Twilio)
    ParentAuthID: process.env.TWILIO_ACCOUNT_SID || 'TWILIO_ACCOUNT',
    
    // Billing fields (Plivo format)
    BillRate: "0.00871", // Standard rate, can be configured
    TotalCost: (parseFloat("0.00871") * callDurationSeconds / 60).toFixed(5),
    
    // Additional Twilio geographic data for future use
    CallerCountry: CallerCountry || FromCountry,
    CalledCountry: CalledCountry || ToCountry,
    CallerState: CallerState || FromState,
    CalledState: CalledState || ToState,
    CallerCity: CallerCity || FromCity,
    CalledCity: CalledCity || ToCity,
    
    // STIR/SHAKEN fields (not applicable for Twilio typically)
    STIRAttestation: "Not Applicable",
    STIRVerification: "Not Applicable",
    
    // Session and campaign fields (IST timezone)
    SessionStart: convertToIST(new Date().toUTCString()),
    campId: campId,
    clientId: clientId,
    tag: callRecord.tag || '',
    assistantId: callRecord.assistantId || '', // Store assistantId for tracking
    hangupFirstName: callRecord.firstName || '',
    callType: campId,
    
    // Provider identification
    provider: "twilio",
    
    // Keep original Twilio data for debugging
    _twilioCallSid: CallSid,
    
    // Recording URL (from status callback)
    RecordUrl: RecordingUrl || null, // Use RecordingUrl from status callback if available
    messages: [],
    conversation_time: null,
    call_sid: "",
    stream_id: "",
    caller_number: sanitizedTo,
    ai_number: sanitizedFrom,
    agent_id: callRecord.tag || '',
    lead_analysis: null,
    summary: null,
    chat: null,
    structuredOutputData: null,
    caller: sanitizedTo,
    exophone: sanitizedFrom
  };
}

/**
 * Maps Twilio recording data to Plivo recording format
 * @param {Object} twilioRecordingData - Raw Twilio recording webhook data
 * @param {Object} callRecord - Call record from database
 * @returns {Object} Plivo-formatted recording data
 */
function mapTwilioRecordingToPlivoFormat(twilioRecordingData, callRecord) {
  const { CallSid, RecordingUrl, RecordingSid, RecordingDuration, From, To } = twilioRecordingData;
  const ourCallUUID = callRecord.callUUID;
  const clientId = callRecord.clientId?.toString() || null;
  const campId = callRecord.campaignId === 'testcall' ? 'testcall' : (callRecord.campaignId?.toString() || 'incoming');
  
  // Sanitize phone numbers
  const sanitizedFrom = From?.replace(/^\+/, '') || '';
  const sanitizedTo = To?.replace(/^\+/, '') || '';
  
  // Helper function to convert UTC timestamp to IST (Indian Standard Time: UTC+5:30)
  const convertToIST = (utcTimestamp) => {
    if (!utcTimestamp) return null;
    const utcDate = new Date(utcTimestamp);
    const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
    return istDate.toISOString().replace('T', ' ').substring(0, 19);
  };
  
  return {
    CallUUID: ourCallUUID, // Use our UUID for consistency
    From: sanitizedFrom,
    To: sanitizedTo,
    RecordingUrl: RecordingUrl,
    RecordingSid: RecordingSid,
    RecordingDuration: RecordingDuration ? parseInt(RecordingDuration) : 0,
    Provider: 'twilio',
    Event: 'Recording',
    RecordingCreatedAt: convertToIST(new Date().toUTCString()),
    createdAt: convertToIST(new Date().toUTCString()),
    
    // Add client and campaign info for proper reporting
    clientId: clientId,
    campId: campId,
    
    // Keep Twilio CallSid for debugging
    _twilioCallSid: CallSid
  };
}

/**
 * Updates existing hangup record with recording URL (Plivo-style)
 * @param {string} recordingUrl - Recording URL from Twilio
 * @param {string} callUUID - Our internal call UUID
 * @returns {Object} Update object for MongoDB
 */
function createRecordingUrlUpdate(recordingUrl, callUUID) {
  return {
    $set: {
      RecordUrl: recordingUrl,
      recordingUpdatedAt: new Date()
    }
  };
}

module.exports = {
  mapTwilioHangupToPlivoFormat,
  mapTwilioRecordingToPlivoFormat,
  createRecordingUrlUpdate
};