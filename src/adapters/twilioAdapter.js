/**
 * Twilio Adapter  
 * Handles Twilio-specific call implementation
 */

const twilio = require('twilio');

class TwilioAdapter {
  /**
   * Make a call using Twilio API
   * @param {Object} callParams - Call parameters
   * @param {Object} providerConfig - Twilio configuration 
   * @returns {Promise<Object>} Call result
   */
  static async makeCall(callParams, providerConfig) {
    try {
      const { from, to, wssUrl, firstName, tag, listId, campaignId, clientId } = callParams;
      
      // Use provided config or fall back to environment
      const accountSid = providerConfig?.accountSid || process.env.TWILIO_ACCOUNT_SID;
      const authToken = providerConfig?.authToken || process.env.TWILIO_AUTH_TOKEN;
      
      if (!accountSid || !authToken) {
        throw new Error('Twilio credentials not configured');
      }
      
      // Initialize Twilio client
      const client = twilio(accountSid, authToken);
      const baseUrl = process.env.BASE_URL || 'https://application.glimpass.com';
      
      // Prepare Twilio-specific parameters
      const campId = campaignId || 'direct';
      const queryParams = new URLSearchParams({
        wss: wssUrl,
        clientId: clientId || '',
        listId: listId || 'direct', 
        campId,
        firstName: firstName || '',
        tag: tag || ''
      }).toString();
      
      const webhookUrls = this.getWebhookUrls(baseUrl, { campId, firstName, tag });
      
      const twilioPayload = {
        from,
        to,
        url: `${webhookUrls.twiml}?${queryParams}`,
        statusCallback: webhookUrls.statusCallback,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        method: 'POST',
        timeout: 60, // Ring timeout in seconds
        record: false // We'll handle recording via TwiML
      };
      
      console.log(`🔵 Twilio API Call:`);
      console.log(`   From: ${from}`);
      console.log(`   To: ${to}`);
      console.log(`   Account SID: ${accountSid}`);
      console.log(`   TwiML URL: ${twilioPayload.url}`);
      console.log(`   Status Callback: ${twilioPayload.statusCallback}`);
      
      const call = await client.calls.create(twilioPayload);
      
      console.log(`✅ Twilio call initiated successfully: ${call.sid}`);
      
      return {
        success: true,
        callUUID: call.sid,
        provider: 'twilio',
        providerResponse: {
          sid: call.sid,
          status: call.status,
          direction: call.direction,
          dateCreated: call.dateCreated
        },
        webhookUrls: {
          twiml: twilioPayload.url,
          statusCallback: twilioPayload.statusCallback
        }
      };
      
    } catch (error) {
      console.error('❌ Twilio adapter error:', error.message);
      
      let errorMessage = 'Twilio API call failed';
      if (error.code) {
        // Twilio-specific error codes
        errorMessage = `Twilio error (${error.code}): ${error.message}`;
      } else if (error.message.includes('credentials')) {
        errorMessage = 'Twilio credentials not configured or invalid';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Twilio API request timed out';
      }
      
      return {
        success: false,
        error: errorMessage,
        provider: 'twilio',
        errorDetails: {
          code: error.code,
          moreInfo: error.moreInfo,
          status: error.status
        }
      };
    }
  }
  
  /**
   * Validate Twilio configuration
   * @param {Object} config - Twilio configuration
   * @returns {Object} Validation result
   */
  static validateConfig(config) {
    const required = ['accountSid', 'authToken'];
    const missing = required.filter(field => !config[field]);
    
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing Twilio config: ${missing.join(', ')}`
      };
    }
    
    // Validate Account SID format (starts with AC)
    if (!config.accountSid.match(/^AC[a-f0-9]{32}$/)) {
      return {
        valid: false,
        error: 'Invalid Twilio Account SID format (should start with AC)'
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Get Twilio-specific webhook URLs
   * @param {string} baseUrl - Base URL for webhooks
   * @param {Object} params - Additional parameters
   * @returns {Object} Webhook URLs
   */
  static getWebhookUrls(baseUrl, params = {}) {
    const { campId = 'direct', firstName = '', tag = '' } = params;
    
    return {
      twiml: `${baseUrl}/twilio/twiml`,
      statusCallback: `${baseUrl}/twilio/status-callback`,
      // For compatibility with existing webhook structure
      ring: `${baseUrl}/twilio/status-callback`, 
      hangup: `${baseUrl}/twilio/status-callback`
    };
  }
  
  /**
   * Map Twilio call status to internal status
   * @param {string} twilioStatus - Twilio call status
   * @returns {string} Internal status
   */
  static mapCallStatus(twilioStatus) {
    const statusMap = {
      'queued': 'processed',
      'initiated': 'processed', 
      'ringing': 'ringing',
      'in-progress': 'ongoing',
      'completed': 'completed',
      'busy': 'failed',
      'failed': 'failed',
      'no-answer': 'failed',
      'canceled': 'failed'
    };
    
    return statusMap[twilioStatus] || 'unknown';
  }
  
  /**
   * Generate TwiML response for call handling
   * @param {Object} params - TwiML parameters
   * @returns {string} TwiML XML
   */
  static generateTwiML(params) {
    const { wssUrl, callSid, clientId, campaignId } = params;
    const baseUrl = process.env.BASE_URL || 'https://application.glimpass.com';
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Start>
        <Stream 
            url="${wssUrl}"
            name="audio_stream">
            <Parameter name="callSid" value="${callSid || ''}" />
            <Parameter name="clientId" value="${clientId || ''}" />
            <Parameter name="campaignId" value="${campaignId || ''}" />
        </Stream>
    </Start>
    <Record 
        action="${baseUrl}/twilio/record-callback"
        recordingStatusCallback="${baseUrl}/twilio/record-status"
        maxLength="3600"
        playBeep="false" />
    <Say voice="alice">Please wait while we connect you.</Say>
</Response>`;
  }
}

module.exports = TwilioAdapter;