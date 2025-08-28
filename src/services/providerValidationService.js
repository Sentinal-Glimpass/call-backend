/**
 * Provider Validation Service
 * Tests provider credentials by making actual API calls
 * Validates credentials before allowing activation
 */

const twilio = require('twilio');
const axios = require('axios');

class ProviderValidationService {
  
  /**
   * Test Twilio credentials by fetching account info and phone numbers
   * @param {Object} credentials - Twilio credentials
   * @returns {Promise<Object>} Validation result
   */
  static async validateTwilioCredentials(credentials) {
    const startTime = Date.now();
    
    try {
      const { accountSid, authToken } = credentials;
      
      if (!accountSid || !authToken) {
        return {
          valid: false,
          error: 'Missing accountSid or authToken',
          details: {
            accountSid: !!accountSid,
            authToken: !!authToken
          }
        };
      }
      
      // Initialize Twilio client
      const client = twilio(accountSid, authToken);
      
      console.log(`🔵 Testing Twilio credentials: ${accountSid.substring(0, 8)}...`);
      
      // Test 1: Fetch account information
      let accountInfo;
      try {
        accountInfo = await client.api.accounts(accountSid).fetch();
        console.log(`✅ Account verified: ${accountInfo.friendlyName} (${accountInfo.status})`);
      } catch (error) {
        console.error(`❌ Account verification failed:`, error.message);
        return {
          valid: false,
          error: `Invalid Twilio credentials: ${error.message}`,
          errorCode: error.code,
          testDuration: Date.now() - startTime
        };
      }
      
      // Test 2: Fetch available phone numbers
      let phoneNumbers = [];
      try {
        const numbers = await client.incomingPhoneNumbers.list({ limit: 20 });
        phoneNumbers = numbers.map(number => ({
          phoneNumber: number.phoneNumber,
          friendlyName: number.friendlyName,
          capabilities: {
            voice: number.capabilities.voice,
            sms: number.capabilities.sms,
            mms: number.capabilities.mms
          },
          status: number.status
        }));
        
        console.log(`📞 Found ${phoneNumbers.length} Twilio phone numbers`);
      } catch (error) {
        console.warn(`⚠️ Could not fetch phone numbers: ${error.message}`);
        // Don't fail validation if phone numbers can't be fetched
      }
      
      // Test 3: Check account balance and status
      let balance = null;
      try {
        const balanceData = await client.balance.fetch();
        balance = {
          currency: balanceData.currency,
          balance: balanceData.balance
        };
        console.log(`💰 Account balance: ${balance.balance} ${balance.currency}`);
      } catch (error) {
        console.warn(`⚠️ Could not fetch balance: ${error.message}`);
      }
      
      return {
        valid: true,
        account: {
          sid: accountInfo.sid,
          friendlyName: accountInfo.friendlyName,
          status: accountInfo.status,
          type: accountInfo.type,
          dateCreated: accountInfo.dateCreated
        },
        phoneNumbers: phoneNumbers,
        balance: balance,
        testDuration: Date.now() - startTime,
        testedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Twilio validation error:', error);
      return {
        valid: false,
        error: `Twilio validation failed: ${error.message}`,
        errorCode: error.code || 'UNKNOWN_ERROR',
        testDuration: Date.now() - startTime
      };
    }
  }
  
  /**
   * Test Plivo credentials by fetching account info
   * @param {Object} credentials - Plivo credentials  
   * @returns {Promise<Object>} Validation result
   */
  static async validatePlivoCredentials(credentials) {
    const startTime = Date.now();
    
    try {
      const { accountSid, authToken } = credentials;
      
      if (!accountSid || !authToken) {
        return {
          valid: false,
          error: 'Missing accountSid or authToken'
        };
      }
      
      console.log(`🟢 Testing Plivo credentials: ${accountSid}...`);
      
      // Create Basic Auth header
      const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      
      // Test 1: Fetch account information
      let accountInfo;
      try {
        const response = await axios.get(`https://api.plivo.com/v1/Account/${accountSid}/`, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        
        accountInfo = response.data;
        console.log(`✅ Plivo account verified: ${accountInfo.name} (${accountInfo.account_type})`);
      } catch (error) {
        console.error(`❌ Plivo account verification failed:`, error.response?.data || error.message);
        return {
          valid: false,
          error: `Invalid Plivo credentials: ${error.response?.data?.error || error.message}`,
          testDuration: Date.now() - startTime
        };
      }
      
      // Test 2: Fetch phone numbers
      let phoneNumbers = [];
      try {
        const response = await axios.get(`https://api.plivo.com/v1/Account/${accountSid}/Number/`, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        
        phoneNumbers = response.data.objects?.map(number => ({
          phoneNumber: number.number,
          region: number.region,
          type: number.type,
          capabilities: {
            voice: number.voice_enabled,
            sms: number.sms_enabled,
            mms: number.mms_enabled
          }
        })) || [];
        
        console.log(`📞 Found ${phoneNumbers.length} Plivo phone numbers`);
      } catch (error) {
        console.warn(`⚠️ Could not fetch Plivo phone numbers: ${error.message}`);
      }
      
      return {
        valid: true,
        account: {
          sid: accountInfo.auth_id,
          name: accountInfo.name,
          accountType: accountInfo.account_type,
          cashCredits: accountInfo.cash_credits,
          state: accountInfo.state
        },
        phoneNumbers: phoneNumbers,
        testDuration: Date.now() - startTime,
        testedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Plivo validation error:', error);
      return {
        valid: false,
        error: `Plivo validation failed: ${error.message}`,
        testDuration: Date.now() - startTime
      };
    }
  }
  
  /**
   * Test WATI credentials by making API call
   * @param {Object} credentials - WATI credentials
   * @returns {Promise<Object>} Validation result  
   */
  static async validateWatiCredentials(credentials) {
    const startTime = Date.now();
    
    try {
      const { accessToken, instanceId } = credentials;
      
      if (!accessToken || !instanceId) {
        return {
          valid: false,
          error: 'Missing accessToken or instanceId'
        };
      }
      
      console.log(`💬 Testing WATI credentials: ${instanceId}...`);
      
      // Test: Fetch WATI instance info
      try {
        const response = await axios.get(`https://live-server-113693.wati.io/api/v1/getBusinessProfile`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        
        const profileData = response.data;
        console.log(`✅ WATI instance verified: ${profileData.displayName || instanceId}`);
        
        return {
          valid: true,
          account: {
            instanceId: instanceId,
            displayName: profileData.displayName,
            about: profileData.about,
            phoneNumber: profileData.phoneNumber,
            profilePicture: profileData.profilePicture
          },
          testDuration: Date.now() - startTime,
          testedAt: new Date().toISOString()
        };
        
      } catch (error) {
        console.error(`❌ WATI validation failed:`, error.response?.data || error.message);
        return {
          valid: false,
          error: `Invalid WATI credentials: ${error.response?.data?.message || error.message}`,
          testDuration: Date.now() - startTime
        };
      }
      
    } catch (error) {
      console.error('❌ WATI validation error:', error);
      return {
        valid: false,
        error: `WATI validation failed: ${error.message}`,
        testDuration: Date.now() - startTime
      };
    }
  }
  
  /**
   * Validate credentials for any provider
   * @param {string} provider - Provider name
   * @param {Object} credentials - Provider credentials
   * @returns {Promise<Object>} Validation result
   */
  static async validateCredentials(provider, credentials) {
    console.log(`🧪 Starting validation for ${provider} provider...`);
    
    switch (provider.toLowerCase()) {
      case 'twilio':
        return await this.validateTwilioCredentials(credentials);
        
      case 'plivo':
        return await this.validatePlivoCredentials(credentials);
        
      case 'wati':
        return await this.validateWatiCredentials(credentials);
        
      default:
        return {
          valid: false,
          error: `Validation not implemented for provider: ${provider}`
        };
    }
  }
  
  /**
   * Get validation requirements for a provider
   * @param {string} provider - Provider name
   * @returns {Object} Validation info
   */
  static getValidationInfo(provider) {
    const validationTests = {
      twilio: [
        'Account authentication',
        'Account status verification', 
        'Phone numbers fetching',
        'Balance checking'
      ],
      plivo: [
        'Account authentication',
        'Account info fetching',
        'Phone numbers listing'
      ],
      wati: [
        'Instance authentication',
        'Business profile fetching'
      ]
    };
    
    return {
      provider: provider,
      tests: validationTests[provider] || ['Basic authentication'],
      estimatedDuration: '3-10 seconds',
      requiresInternet: true
    };
  }
}

module.exports = ProviderValidationService;