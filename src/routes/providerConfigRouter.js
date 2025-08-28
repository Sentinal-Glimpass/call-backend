/**
 * Provider Configuration Router
 * Dynamic API for frontend provider configuration and management
 */

const express = require('express');
const router = express.Router();
const ProviderMetadataService = require('../services/providerMetadataService');
const TelephonyCredentialsService = require('../services/telephonyCredentialsService');
const ProviderValidationService = require('../services/providerValidationService');
const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');

/**
 * @swagger
 * tags:
 *   name: Provider Configuration
 *   description: Dynamic provider configuration for frontend
 */

/**
 * @swagger
 * /provider-config/providers:
 *   get:
 *     tags: [Provider Configuration]
 *     summary: Get all available providers with their configurations
 *     description: Returns provider metadata for dynamic frontend form generation
 *     responses:
 *       200:
 *         description: List of available providers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 providers:
 *                   type: object
 *                 categories:
 *                   type: array
 *                 capabilities:
 *                   type: array
 */
router.get('/providers', (req, res) => {
  try {
    const providers = ProviderMetadataService.getAllProviders();
    const categories = ProviderMetadataService.getCategories();
    const capabilities = ProviderMetadataService.getAllCapabilities();
    
    res.json({
      success: true,
      providers,
      categories,
      capabilities,
      defaults: {
        voice: ProviderMetadataService.getDefaultProvider('voice'),
        sms: ProviderMetadataService.getDefaultProvider('sms'), 
        whatsapp: ProviderMetadataService.getDefaultProvider('whatsapp')
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting provider configurations:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /provider-config/providers/{providerName}/fields:
 *   get:
 *     tags: [Provider Configuration]
 *     summary: Get form fields for a specific provider
 *     description: Returns field definitions for dynamic form generation
 *     parameters:
 *       - in: path
 *         name: providerName
 *         required: true
 *         schema:
 *           type: string
 *           enum: [plivo, twilio, wati]
 *     responses:
 *       200:
 *         description: Provider form fields
 */
router.get('/providers/:providerName/fields', (req, res) => {
  try {
    const { providerName } = req.params;
    const fields = ProviderMetadataService.getProviderFields(providerName);
    
    if (fields.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Unknown provider: ${providerName}`
      });
    }
    
    res.json({
      success: true,
      provider: providerName,
      fields,
      config: ProviderMetadataService.getProviderConfig(providerName)
    });
    
  } catch (error) {
    console.error('❌ Error getting provider fields:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /provider-config/validate:
 *   post:
 *     tags: [Provider Configuration]
 *     summary: Validate provider credentials format
 *     description: Validate credentials format without making API calls
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - provider
 *               - credentials
 *             properties:
 *               provider:
 *                 type: string
 *               credentials:
 *                 type: object
 */
router.post('/validate', (req, res) => {
  try {
    const { provider, credentials } = req.body;
    
    if (!provider || !credentials) {
      return res.status(400).json({
        success: false,
        error: 'Provider and credentials are required'
      });
    }
    
    const validation = ProviderMetadataService.validateCredentials(provider, credentials);
    
    res.json({
      success: true,
      validation,
      provider
    });
    
  } catch (error) {
    console.error('❌ Error validating credentials:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /provider-config/test-credentials:
 *   post:
 *     tags: [Provider Configuration]
 *     summary: Test provider credentials with live API calls
 *     description: Validates credentials by making actual API calls to fetch account info and phone numbers
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - provider
 *               - credentials
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [twilio, plivo, wati]
 *                 example: "twilio"
 *               credentials:
 *                 type: object
 *                 example:
 *                   accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
 *                   authToken: "your_auth_token_here"
 *     responses:
 *       200:
 *         description: Credential test results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 valid:
 *                   type: boolean
 *                 account:
 *                   type: object
 *                 phoneNumbers:
 *                   type: array
 *                 testDuration:
 *                   type: number
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Server error
 */
router.post('/test-credentials', async (req, res) => {
  try {
    const { provider, credentials } = req.body;
    
    if (!provider || !credentials) {
      return res.status(400).json({
        success: false,
        error: 'Provider and credentials are required'
      });
    }
    
    console.log(`🧪 Testing ${provider} credentials...`);
    
    // First validate format
    const formatValidation = ProviderMetadataService.validateCredentials(provider, credentials);
    if (!formatValidation.valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: 'Invalid credential format',
        formatErrors: formatValidation.errors || [formatValidation.error],
        provider
      });
    }
    
    // Then test with live API calls
    const testResult = await ProviderValidationService.validateCredentials(provider, credentials);
    
    if (testResult.valid) {
      console.log(`✅ ${provider} credentials test passed`);
    } else {
      console.log(`❌ ${provider} credentials test failed: ${testResult.error}`);
    }
    
    res.json({
      success: true,
      provider,
      ...testResult
    });
    
  } catch (error) {
    console.error('❌ Error testing credentials:', error);
    res.status(500).json({
      success: false,
      valid: false,
      error: 'Internal server error during credential testing'
    });
  }
});

/**
 * @swagger
 * /provider-config/validation-info/{provider}:
 *   get:
 *     tags: [Provider Configuration]
 *     summary: Get validation requirements for a provider
 *     description: Returns information about what tests will be performed during validation
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [twilio, plivo, wati]
 *     responses:
 *       200:
 *         description: Validation info
 */
router.get('/validation-info/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    
    const validationInfo = ProviderValidationService.getValidationInfo(provider);
    
    res.json({
      success: true,
      ...validationInfo
    });
    
  } catch (error) {
    console.error('❌ Error getting validation info:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /provider-config/client/{clientId}/status:
 *   get:
 *     tags: [Provider Configuration]
 *     summary: Get client's provider activation status
 *     description: Returns which providers are active for a client
 */
router.get('/client/:clientId/status', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: 'Client ID is required'
      });
    }
    
    // Get client info with provider flags
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const clientCollection = database.collection("client");
    
    const clientData = await clientCollection.findOne(
      { _id: new ObjectId(clientId) },
      { 
        projection: { 
          clientName: 1, 
          telephonyProviders: 1, 
          telephonySettings: 1,
          providersLastUpdated: 1 
        } 
      }
    );
    
    if (!clientData) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }
    
    // Apply defaults for backward compatibility
    const defaultProviders = {
      plivo_active: true,
      twilio_active: false,
      wati_active: false
    };
    
    const providerStatus = {
      ...defaultProviders,
      ...clientData.telephonyProviders
    };
    
    // Get configured credentials
    const credentials = await TelephonyCredentialsService.listClientCredentials(clientId);
    const credentialMap = {};
    credentials.forEach(cred => {
      credentialMap[cred.provider] = {
        configured: true,
        accountSid: cred.accountSid,
        isActive: cred.isActive,
        lastUsed: cred.lastUsed,
        createdAt: cred.createdAt
      };
    });
    
    res.json({
      success: true,
      clientId,
      clientName: clientData.clientName,
      providerStatus,
      credentials: credentialMap,
      settings: clientData.telephonySettings || {
        defaultVoiceProvider: "plivo",
        defaultSmsProvider: "plivo", 
        defaultWhatsappProvider: "wati"
      },
      lastUpdated: clientData.providersLastUpdated
    });
    
  } catch (error) {
    console.error('❌ Error getting client provider status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /provider-config/client/{clientId}/activate:
 *   post:
 *     tags: [Provider Configuration]
 *     summary: Activate/deactivate providers for client
 *     description: Update client's provider activation flags with optional credential validation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               providers:
 *                 type: object
 *                 example:
 *                   twilio_active: true
 *               requireValidation:
 *                 type: boolean
 *                 description: Whether to test credentials before activation
 *                 default: true
 */
router.post('/client/:clientId/activate', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { providers, requireValidation = true } = req.body;
    
    if (!clientId || !providers) {
      return res.status(400).json({
        success: false,
        error: 'Client ID and providers configuration required'
      });
    }
    
    // Validate provider flags
    const validProviders = ['plivo_active', 'twilio_active', 'wati_active'];
    const updates = {};
    const validationResults = {};
    
    for (const [key, value] of Object.entries(providers)) {
      if (validProviders.includes(key) && typeof value === 'boolean') {
        
        // If activating a provider and validation is required
        if (value === true && requireValidation) {
          const providerName = key.replace('_active', '');
          
          try {
            // Get stored credentials for this client and provider
            console.log(`🔍 Getting credentials for client ${clientId}, provider ${providerName}...`);
            const credentialsRecord = await TelephonyCredentialsService.getCredentials(clientId, providerName);
            
            console.log(`🔍 DEBUG - Credentials record type:`, typeof credentialsRecord);
            console.log(`🔍 DEBUG - Credentials record exists:`, !!credentialsRecord);
            console.log(`🔍 DEBUG - isClientSpecific:`, credentialsRecord?.isClientSpecific);
            console.log(`🔍 DEBUG - isDefault:`, credentialsRecord?.isDefault);
            console.log(`🔍 DEBUG - Full credentials record for ${providerName}:`, JSON.stringify(credentialsRecord, null, 2));
            
            if (credentialsRecord && (credentialsRecord.isClientSpecific || credentialsRecord.isDefault)) {
              console.log(`🧪 Validating ${providerName} credentials before activation...`);
              console.log(`🔍 Credentials type: ${credentialsRecord.isClientSpecific ? 'client-specific' : 'default'}`);
              
              // Debug: Check what fields are actually available
              console.log(`🔍 Available fields:`, Object.keys(credentialsRecord));
              console.log(`🔍 AccountSid value:`, credentialsRecord.accountSid);
              console.log(`🔍 AuthToken exists:`, !!credentialsRecord.authToken);
              
              // Test the credentials (credentialsRecord should have decrypted values)
              console.log(`🔍 About to validate credentials - AccountSid: ${credentialsRecord.accountSid}, AuthToken exists: ${!!credentialsRecord.authToken}`);
              const testResult = await ProviderValidationService.validateCredentials(providerName, credentialsRecord);
              validationResults[providerName] = testResult;
              
              if (!testResult.valid) {
                return res.status(400).json({
                  success: false,
                  error: `Cannot activate ${providerName}: credential validation failed`,
                  validationError: testResult.error,
                  provider: providerName
                });
              }
              
              console.log(`✅ ${providerName} credentials validated successfully`);
              
              // Store validation timestamp in credentials
              await TelephonyCredentialsService.updateCredentials(clientId, providerName, {
                lastValidated: new Date(),
                validationResult: {
                  valid: true,
                  testedAt: testResult.testedAt,
                  account: testResult.account
                }
              });
              
            } else {
              console.log(`⚠️ Using system default ${providerName} credentials (no validation required)`);
            }
            
          } catch (validationError) {
            console.error(`❌ Validation error for ${providerName}:`, validationError);
            return res.status(500).json({
              success: false,
              error: `Validation failed for ${providerName}: ${validationError.message}`,
              provider: providerName
            });
          }
        }
        
        updates[`telephonyProviders.${key}`] = value;
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid provider flags provided'
      });
    }
    
    // Update client record
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const clientCollection = database.collection("client");
    
    const result = await clientCollection.updateOne(
      { _id: new ObjectId(clientId) },
      { 
        $set: {
          ...updates,
          providersLastUpdated: new Date(),
          updatedAt: new Date()
        }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }
    
    console.log(`✅ Updated provider activation for client ${clientId}:`, updates);
    
    const response = {
      success: true,
      message: 'Provider activation updated successfully',
      clientId,
      updates
    };
    
    // Include validation results if any were performed
    if (Object.keys(validationResults).length > 0) {
      response.validationResults = validationResults;
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error updating provider activation:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /provider-config/client/{clientId}/settings:
 *   put:
 *     tags: [Provider Configuration]
 *     summary: Update client's telephony settings
 *     description: Update default providers and preferences
 */
router.put('/client/:clientId/settings', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { settings } = req.body;
    
    if (!clientId || !settings) {
      return res.status(400).json({
        success: false,
        error: 'Client ID and settings are required'
      });
    }
    
    const validSettings = [
      'defaultVoiceProvider', 
      'defaultSmsProvider', 
      'defaultWhatsappProvider',
      'enableFailover',
      'failoverSequence'
    ];
    
    const updates = {};
    for (const [key, value] of Object.entries(settings)) {
      if (validSettings.includes(key)) {
        updates[`telephonySettings.${key}`] = value;
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid settings provided'
      });
    }
    
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const clientCollection = database.collection("client");
    
    const result = await clientCollection.updateOne(
      { _id: new ObjectId(clientId) },
      { 
        $set: {
          ...updates,
          providersLastUpdated: new Date(),
          updatedAt: new Date()
        }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }
    
    console.log(`✅ Updated telephony settings for client ${clientId}:`, updates);
    
    res.json({
      success: true,
      message: 'Telephony settings updated successfully',
      clientId,
      updates
    });
    
  } catch (error) {
    console.error('❌ Error updating telephony settings:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /provider-config/client/{clientId}/sync-phone-numbers:
 *   post:
 *     tags: [Provider Configuration]
 *     summary: Sync phone numbers from provider credentials to client caller numbers
 *     description: Updates client's caller numbers with phone numbers from their provider credentials
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               providers:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["twilio", "plivo"]
 *                 description: "Specific providers to sync (default: all active providers)"
 *     responses:
 *       200:
 *         description: Phone numbers synced successfully
 */
router.post('/client/:clientId/sync-phone-numbers', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { providers: specificProviders } = req.body;
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: 'Client ID is required'
      });
    }
    
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const clientCollection = database.collection("client");
    
    // Get client's current data
    const clientData = await clientCollection.findOne(
      { _id: new ObjectId(clientId) },
      { projection: { telephonyProviders: 1, callerNumbers: 1, clientName: 1 } }
    );
    
    if (!clientData) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }
    
    // Determine which providers to sync
    const activeProviders = [];
    const providerStatus = clientData.telephonyProviders || {};
    
    if (providerStatus.plivo_active) activeProviders.push('plivo');
    if (providerStatus.twilio_active) activeProviders.push('twilio');
    if (providerStatus.wati_active) activeProviders.push('wati');
    
    const providersToSync = specificProviders || activeProviders;
    
    console.log(`📞 Syncing phone numbers for client ${clientId} from providers: ${providersToSync.join(', ')}`);
    
    // Collect phone numbers from all provider credentials
    const allPhoneNumbers = new Set(clientData.callerNumbers || []);
    const syncResults = {};
    
    for (const provider of providersToSync) {
      try {
        const credentials = await TelephonyCredentialsService.listClientCredentials(clientId);
        const providerCreds = credentials.find(cred => cred.provider === provider);
        
        if (providerCreds && providerCreds.credentials.phoneNumbers) {
          let phoneNumbers = [];
          
          // Handle phone numbers (could be string or array)
          if (typeof providerCreds.credentials.phoneNumbers === 'string') {
            phoneNumbers = providerCreds.credentials.phoneNumbers
              .split(',') 
              .map(num => num.trim())
              .filter(num => num.length > 0);
          } else if (Array.isArray(providerCreds.credentials.phoneNumbers)) {
            phoneNumbers = providerCreds.credentials.phoneNumbers;
          }
          
          // Add to set (removes duplicates)
          phoneNumbers.forEach(number => {
            // Normalize phone number format
            const normalizedNumber = number.startsWith('+') ? number : `+${number}`;
            allPhoneNumbers.add(normalizedNumber);
          });
          
          syncResults[provider] = {
            found: phoneNumbers.length,
            numbers: phoneNumbers
          };
          
          console.log(`📞 ${provider}: Found ${phoneNumbers.length} phone numbers`);
        } else {
          syncResults[provider] = {
            found: 0,
            numbers: [],
            note: 'No credentials or phone numbers configured'
          };
        }
        
      } catch (error) {
        console.error(`❌ Error syncing ${provider} numbers:`, error);
        syncResults[provider] = {
          error: error.message,
          found: 0,
          numbers: []
        };
      }
    }
    
    // Update client's caller numbers
    const updatedNumbers = Array.from(allPhoneNumbers);
    
    const result = await clientCollection.updateOne(
      { _id: new ObjectId(clientId) },
      { 
        $set: { 
          callerNumbers: updatedNumbers,
          phoneNumbersLastSynced: new Date(),
          updatedAt: new Date()
        }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Failed to update client caller numbers'
      });
    }
    
    console.log(`✅ Updated caller numbers for client ${clientId}: ${updatedNumbers.length} total numbers`);
    
    res.json({
      success: true,
      message: 'Phone numbers synced successfully',
      clientId,
      syncResults,
      callerNumbers: updatedNumbers,
      totalNumbers: updatedNumbers.length,
      providersChecked: providersToSync
    });
    
  } catch (error) {
    console.error('❌ Error syncing phone numbers:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;