/**
 * Unified Call Provider Service
 * Routes calls to appropriate provider (Plivo/Twilio) based on phone number mapping
 */

const PhoneProviderService = require('./phoneProviderService');
const PlivoAdapter = require('../adapters/plivoAdapter');
const TwilioAdapter = require('../adapters/twilioAdapter');

class CallProviderService {
  /**
   * Make a call using the appropriate provider based on phone number mapping
   * @param {Object} callParams - Call parameters
   * @returns {Promise<Object>} Call result with provider info
   */
  static async makeCall(callParams) {
    try {
      const { from, to, wssUrl, clientId, campaignId, firstName, tag, listId } = callParams;
      
      console.log(`📞 Unified call routing: ${from} → ${to}`);
      
      // Get provider for the 'from' number
      const providerInfo = await PhoneProviderService.getProvider(from);
      
      console.log(`🎯 Provider selected: ${providerInfo.provider} (isDefault: ${providerInfo.isDefault || false})`);
      
      let callResult;
      
      switch (providerInfo.provider) {
        case 'twilio':
          console.log('🔵 Routing to Twilio...');
          callResult = await TwilioAdapter.makeCall(callParams, providerInfo.providerConfig);
          break;
          
        case 'plivo':
        default:
          console.log('🟢 Routing to Plivo...');
          callResult = await PlivoAdapter.makeCall(callParams, providerInfo.providerConfig);
          break;
      }
      
      // Add provider metadata to result
      return {
        ...callResult,
        provider: providerInfo.provider,
        providerConfig: {
          // Don't expose sensitive config in response
          accountSid: providerInfo.providerConfig?.accountSid || 'hidden',
          isDefault: providerInfo.isDefault || false
        }
      };
      
    } catch (error) {
      console.error('❌ Error in unified call routing:', error);
      return {
        success: false,
        error: `Call routing failed: ${error.message}`,
        provider: 'unknown'
      };
    }
  }
  
  /**
   * Get provider information for a phone number (utility method)
   * @param {string} phoneNumber - Phone number to lookup
   * @returns {Promise<Object>} Provider information
   */
  static async getProviderInfo(phoneNumber) {
    try {
      return await PhoneProviderService.getProvider(phoneNumber);
    } catch (error) {
      console.error('❌ Error getting provider info:', error);
      throw error;
    }
  }
  
  /**
   * List all supported providers
   * @returns {Array} List of supported providers
   */
  static getSupportedProviders() {
    return [
      {
        name: 'plivo',
        displayName: 'Plivo',
        isDefault: true,
        features: ['voice', 'sms', 'recording', 'streaming']
      },
      {
        name: 'twilio',
        displayName: 'Twilio',
        isDefault: false,
        features: ['voice', 'sms', 'recording', 'streaming']
      }
    ];
  }
  
  /**
   * Validate call parameters
   * @param {Object} callParams - Call parameters to validate
   * @returns {Object} Validation result
   */
  static validateCallParams(callParams) {
    const required = ['from', 'to', 'wssUrl', 'clientId'];
    const missing = required.filter(param => !callParams[param]);
    
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing required parameters: ${missing.join(', ')}`
      };
    }
    
    // Validate phone number format (basic)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(callParams.from.replace(/\s+/g, ''))) {
      return {
        valid: false,
        error: 'Invalid from phone number format'
      };
    }
    
    if (!phoneRegex.test(callParams.to.replace(/\s+/g, ''))) {
      return {
        valid: false,
        error: 'Invalid to phone number format'
      };
    }
    
    // Validate WebSocket URL
    try {
      new URL(callParams.wssUrl);
    } catch {
      return {
        valid: false,
        error: 'Invalid WebSocket URL format'
      };
    }
    
    return { valid: true };
  }
}

module.exports = CallProviderService;