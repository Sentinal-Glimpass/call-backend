/**
 * Unified Call Provider Service
 * Routes calls to appropriate provider (Plivo/Twilio) based on phone number mapping
 */

const PhoneProviderService = require('./phoneProviderService');
const TelephonyCredentialsService = require('./telephonyCredentialsService');
const PlivoAdapter = require('../adapters/plivoAdapter');
const TwilioAdapter = require('../adapters/twilioAdapter');

class CallProviderService {
  /**
   * Make a call using the appropriate provider based on explicit provider or phone number mapping
   * @param {Object} callParams - Call parameters (now supports optional 'provider' field)
   * @returns {Promise<Object>} Call result with provider info
   */
  static async makeCall(callParams) {
    try {
      const { from, to, wssUrl, clientId, campaignId, firstName, tag, email, listId, provider, dynamicFields } = callParams;

      console.log(`📞 Unified call routing: ${from} → ${to} (Client: ${clientId})`);
      console.log(`🔍 CALLPROVIDERSERVICE DEBUG - Provider parameter received:`, provider);

      // Log dynamic fields for debugging
      if (dynamicFields && Object.keys(dynamicFields).length > 0) {
        const fieldNames = Object.keys(dynamicFields).filter(key => !['listId', '_id'].includes(key));
        console.log(`📋 Dynamic CSV fields detected: ${fieldNames.join(', ')}`);
      }
      
      let providerInfo;
      
      // If provider is explicitly specified, use it directly
      if (provider) {
        console.log(`🎯 Using explicitly specified provider: ${provider}`);
        providerInfo = {
          provider: provider.toLowerCase(),
          phoneNumber: from,
          isExplicit: true
        };
      } else {
        console.log(`🔍 Determining provider based on phone number mapping...`);
        // Fallback to phone number mapping
        providerInfo = await PhoneProviderService.getProvider(from);
      }
      
      console.log(`🎯 Provider selected: ${providerInfo.provider} (isDefault: ${providerInfo.isDefault || false})`);
      
      // Get client-specific credentials or fallback to system defaults
      let finalCredentials;
      if (clientId) {
        console.log(`🔐 Looking up client-specific credentials for client ${clientId}...`);
        finalCredentials = await TelephonyCredentialsService.getCredentials(clientId, providerInfo.provider);
        
        // Update last used timestamp
        if (finalCredentials.isClientSpecific) {
          await TelephonyCredentialsService.updateLastUsed(clientId, providerInfo.provider);
        }
      } else {
        console.log(`⚠️  No clientId provided, using system default credentials`);
        finalCredentials = TelephonyCredentialsService.getSystemDefaultCredentials(providerInfo.provider, 'unknown');
      }
      
      // Verify phone number ownership for client-specific credentials
      if (finalCredentials.isClientSpecific && finalCredentials.validatedPhoneNumbers?.length > 0) {
        const normalizedFrom = from.replace(/^\+/, '').replace(/\s+/g, '');
        const ownsNumber = finalCredentials.validatedPhoneNumbers.some(
          num => num.phoneNumber === normalizedFrom || num.phoneNumber === from
        );
        if (!ownsNumber) {
          console.log(`⚠️ FROM number ${from} not in client's validated numbers, falling back to system credentials`);
          finalCredentials = TelephonyCredentialsService.getSystemDefaultCredentials(providerInfo.provider, clientId);
        }
      }

      console.log(`🔑 Using ${finalCredentials.isClientSpecific ? 'client-specific' : 'system default'} credentials`);

      let callResult;
      
      switch (providerInfo.provider) {
        case 'twilio':
          console.log('🔵 Routing to Twilio...');
          callResult = await TwilioAdapter.makeCall(callParams, finalCredentials);
          break;
          
        case 'plivo':
        default:
          console.log('🟢 Routing to Plivo...');
          callResult = await PlivoAdapter.makeCall(callParams, finalCredentials);
          break;
      }
      
      // Call tracking is now handled within each adapter to prevent race conditions
      
      // Add provider metadata to result
      return {
        ...callResult,
        provider: providerInfo.provider,
        providerConfig: {
          // Don't expose sensitive config in response
          accountSid: finalCredentials?.accountSid ? 
            TelephonyCredentialsService.maskCredential(finalCredentials.accountSid) : 'hidden',
          isDefault: providerInfo.isDefault || false,
          isClientSpecific: finalCredentials?.isClientSpecific || false
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