/**
 * Plivo Adapter
 * Handles Plivo-specific call implementation
 */

const axios = require('axios');

class PlivoAdapter {
  /**
   * Make a call using Plivo API
   * @param {Object} callParams - Call parameters  
   * @param {Object} providerConfig - Plivo configuration
   * @returns {Promise<Object>} Call result
   */
  static async makeCall(callParams, providerConfig) {
    try {
      const { from, to, wssUrl, firstName, tag, email, listId, campaignId, clientId, dynamicFields } = callParams;

      // Use provided config or fall back to environment/defaults
      const accountSid = providerConfig?.accountSid || process.env.PLIVO_ACCOUNT_SID || 'default_account_sid';
      const authToken = providerConfig?.authToken || process.env.PLIVO_AUTH_TOKEN || 'default_auth_token';

      const plivoApiUrl = `https://api.plivo.com/v1/Account/${accountSid}/Call/`;
      const baseUrl = process.env.BASE_URL || 'https://application.glimpass.com';

      // Prepare contact data with ALL CSV fields (dynamic columns support) - FLAT, NO NESTING
      const contactData = dynamicFields || {};
      const campId = campaignId || 'direct';

      // DEBUG: Log what we received
      console.log(`📋 [Plivo Adapter] Received dynamicFields:`, {
        fieldCount: Object.keys(contactData).length,
        fields: Object.keys(contactData),
        email: contactData.email,
        firstName: firstName,
        emailParam: email
      });

      // Build answer_url with ALL CSV fields as individual query parameters
      const answerUrlParams = new URLSearchParams({
        wss: wssUrl,
        clientId: clientId,
        listId: listId || 'direct',
        campId: campId
      });

      // Add ALL CSV fields as individual query parameters (flat structure)
      let csvFieldCount = 0;
      for (const [key, value] of Object.entries(contactData)) {
        // Skip internal MongoDB fields
        if (!['_id', 'listId'].includes(key) && value !== undefined && value !== null) {
          answerUrlParams.append(key, String(value));
          csvFieldCount++;
        }
      }

      // Ensure backward compatibility - add standard fields if not present
      if (!contactData.firstName && firstName) answerUrlParams.set('firstName', firstName);
      if (!contactData.first_name && firstName) answerUrlParams.set('first_name', firstName);
      if (!contactData.email && email) answerUrlParams.set('email', email);
      if (!contactData.tag && tag) answerUrlParams.set('tag', tag);

      console.log(`📋 [Plivo] Passing ${csvFieldCount} CSV fields as flat query parameters`);

      const answerUrl = `${baseUrl}/ip/xml-plivo?${answerUrlParams.toString()}`;

      // DEBUG: Log the complete answer URL to verify all parameters
      console.log(`🔗 [Plivo] Answer URL:`, answerUrl.substring(0, 300) + (answerUrl.length > 300 ? '...' : ''));
      console.log(`🔗 [Plivo] Query params in URL:`, Array.from(answerUrlParams.entries()).map(([k, v]) => `${k}=${v.substring(0, 20)}`));

      const payload = {
        from,
        to,
        ring_url: `${baseUrl}/plivo/ring-url`,
        hangup_url: `${baseUrl}/plivo/hangup-url?campId=${campId}&hangupFirstName=${firstName || ''}&tag=${tag || ''}`,
        answer_url: answerUrl,
        answer_method: 'POST',
      };
      
      // Create auth header from credentials
      const authHeader = this.createAuthHeader(accountSid, authToken);
      
      console.log(`🟢 Plivo API Call:`);
      console.log(`   From: ${from}`);
      console.log(`   To: ${to}`);
      console.log(`   Account SID: ${accountSid}`);
      console.log(`   Ring URL: ${payload.ring_url}`);
      console.log(`   Answer URL: ${payload.answer_url}`);
      
      const response = await axios.post(plivoApiUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        timeout: 30000 // 30 second timeout
      });
      
      console.log(`✅ Plivo call initiated successfully: ${response.data.request_uuid}`);
      
      return {
        success: true,
        callUUID: response.data.request_uuid,
        provider: 'plivo',
        providerResponse: {
          api_id: response.data.api_id,
          message: response.data.message,
          request_uuid: response.data.request_uuid
        },
        webhookUrls: {
          ring: payload.ring_url,
          hangup: payload.hangup_url,
          answer: payload.answer_url
        }
      };
      
    } catch (error) {
      console.error('❌ Plivo adapter error:', error.message);
      
      let errorMessage = 'Plivo API call failed';
      if (error.response) {
        const status = error.response.status;
        const responseData = error.response.data;
        
        if (status === 401) {
          errorMessage = `Plivo authentication failed (401): Invalid account SID or auth token. Check credentials for account: ${accountSid}`;
          console.error(`🔑 Invalid Plivo credentials detected:`);
          console.error(`   Account SID: ${accountSid}`);
          console.error(`   Auth Token: ${authToken ? '[REDACTED - length: ' + authToken.length + ']' : '[MISSING]'}`);
        } else {
          errorMessage = `Plivo API error (${status}): ${responseData?.error || error.response.statusText}`;
        }
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Unable to connect to Plivo API';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'Plivo API request timed out';
      }
      
      return {
        success: false,
        error: errorMessage,
        provider: 'plivo',
        errorDetails: {
          code: error.code,
          status: error.response?.status,
          data: error.response?.data
        }
      };
    }
  }
  
  /**
   * Create Basic Auth header for Plivo
   * @param {string} accountSid - Account SID
   * @param {string} authToken - Auth Token
   * @returns {string} Authorization header value
   */
  static createAuthHeader(accountSid, authToken) {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    return `Basic ${credentials}`;
  }
  
  /**
   * Validate Plivo configuration
   * @param {Object} config - Plivo configuration
   * @returns {Object} Validation result
   */
  static validateConfig(config) {
    const required = ['accountSid', 'authToken'];
    const missing = required.filter(field => !config[field]);
    
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing Plivo config: ${missing.join(', ')}`
      };
    }
    
    // Validate Account SID format (basic)
    if (!config.accountSid.match(/^[A-Z0-9]{20}$/)) {
      return {
        valid: false,
        error: 'Invalid Plivo Account SID format'
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Get Plivo-specific webhook URLs
   * @param {string} baseUrl - Base URL for webhooks
   * @param {Object} params - Additional parameters
   * @returns {Object} Webhook URLs
   */
  static getWebhookUrls(baseUrl, params = {}) {
    const { campId = 'direct', firstName = '', tag = '' } = params;
    
    return {
      ring: `${baseUrl}/plivo/ring-url`,
      hangup: `${baseUrl}/plivo/hangup-url?campId=${campId}&hangupFirstName=${firstName}&tag=${tag}`,
      answer: `${baseUrl}/ip/xml-plivo`
    };
  }
}

module.exports = PlivoAdapter;