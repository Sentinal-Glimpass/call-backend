/**
 * Telephony Credentials Management Router
 * API endpoints for managing client-specific telephony provider credentials
 */

const express = require('express');
const router = express.Router();
const TelephonyCredentialsService = require('../services/telephonyCredentialsService');
const ProviderValidationService = require('../services/providerValidationService');
const { 
  authenticateToken, 
  validateResourceOwnership, 
  auditLog 
} = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Telephony Credentials
 *   description: Client-specific telephony provider credentials management
 */

/**
 * @swagger
 * /telephony-credentials/add:
 *   post:
 *     tags: [Telephony Credentials]
 *     summary: Add telephony credentials for a client
 *     description: Add Plivo or Twilio credentials for a specific client
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - provider
 *               - accountSid
 *               - authToken
 *             properties:
 *               clientId:
 *                 type: string
 *                 description: Client ObjectId
 *                 example: "507f1f77bcf86cd799439011"
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *                 example: "twilio"
 *               accountSid:
 *                 type: string
 *                 description: Provider Account SID
 *                 example: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
 *               authToken:
 *                 type: string
 *                 description: Provider Auth Token
 *                 example: "your_auth_token_here"
 *               phoneNumbers:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Associated phone numbers
 *                 example: ["+18005551234", "+18005556789"]
 *               metadata:
 *                 type: object
 *                 description: Additional metadata
 *                 properties:
 *                   region:
 *                     type: string
 *                     example: "us-east-1"
 *                   billing_enabled:
 *                     type: boolean
 *                     example: true
 *     responses:
 *       201:
 *         description: Credentials added successfully
 *       400:
 *         description: Invalid input or credentials already exist
 *       401:
 *         description: Unauthorized
 */
router.post('/add', authenticateToken, auditLog, async (req, res) => {
  try {
    const { clientId, provider } = req.body;
    
    // Validate basic required fields
    if (!clientId || !provider) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: clientId, provider'
      });
    }
    
    // Get provider configuration to determine required fields
    const ProviderMetadataService = require('../services/providerMetadataService');
    const providerConfig = ProviderMetadataService.getProviderConfig(provider);
    
    if (!providerConfig) {
      return res.status(400).json({
        success: false,
        error: `Unsupported provider: ${provider}`
      });
    }
    
    // Validate provider-specific required fields
    const missingFields = [];
    providerConfig.requiredFields.forEach(field => {
      if (!req.body[field.key]) {
        missingFields.push(field.label);
      }
    });
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields for ${provider}: ${missingFields.join(', ')}`
      });
    }
    
    // Pass all request body data to the service (it will handle field extraction)
    const result = await TelephonyCredentialsService.addCredentials(req.body);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    // Build response based on what was actually added
    const response = {
      success: true,
      message: 'Telephony credentials added successfully',
      id: result.id,
      provider: result.provider || provider
    };
    
    // Add provider-specific identifier field
    if (provider === 'wati') {
      response.accessToken = result.accessToken ? 'provided' : 'not provided';
    } else {
      response.accountSid = result.accountSid;
    }
    
    res.status(201).json(response);
    
  } catch (error) {
    console.error('❌ Error adding telephony credentials:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /telephony-credentials/{clientId}:
 *   get:
 *     tags: [Telephony Credentials]
 *     summary: List client's telephony credentials
 *     description: Get all telephony credentials for a client (masked for security)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ObjectId
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       200:
 *         description: List of client credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 credentials:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       provider:
 *                         type: string
 *                       accountSid:
 *                         type: string
 *                         description: Masked Account SID
 *                       phoneNumbers:
 *                         type: array
 *                         items:
 *                           type: string
 *                       isActive:
 *                         type: boolean
 *                       createdAt:
 *                         type: string
 *                       lastUsed:
 *                         type: string
 *       400:
 *         description: Invalid client ID
 *       401:
 *         description: Unauthorized
 */
router.get('/:clientId', authenticateToken, auditLog, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: 'Client ID is required'
      });
    }
    
    const credentials = await TelephonyCredentialsService.listClientCredentials(clientId);
    
    res.json({
      success: true,
      clientId: clientId,
      count: credentials.length,
      credentials: credentials
    });
    
  } catch (error) {
    console.error('❌ Error listing client credentials:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /telephony-credentials/{clientId}/{provider}:
 *   get:
 *     tags: [Telephony Credentials]
 *     summary: Get specific provider credentials for client
 *     description: Get decrypted credentials for a specific provider (internal use)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ObjectId
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *         description: Provider name
 *     responses:
 *       200:
 *         description: Provider credentials
 *       404:
 *         description: Credentials not found
 */
router.get('/:clientId/:provider', authenticateToken, auditLog, async (req, res) => {
  try {
    const { clientId, provider } = req.params;
    
    if (!clientId || !provider) {
      return res.status(400).json({
        success: false,
        error: 'Client ID and provider are required'
      });
    }
    
    if (!['plivo', 'twilio'].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: 'Provider must be plivo or twilio'
      });
    }
    
    const credentials = await TelephonyCredentialsService.getCredentials(clientId, provider);
    
    res.json({
      success: true,
      credentials: {
        clientId: credentials.clientId,
        provider: credentials.provider,
        accountSid: credentials.isClientSpecific ? 
          TelephonyCredentialsService.maskCredential(credentials.accountSid) : 
          credentials.accountSid,
        isClientSpecific: credentials.isClientSpecific || false,
        isDefault: credentials.isDefault || false
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting provider credentials:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /telephony-credentials/{clientId}/{provider}:
 *   put:
 *     tags: [Telephony Credentials]
 *     summary: Update telephony credentials
 *     description: Update existing telephony credentials for a client and provider
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accountSid:
 *                 type: string
 *               authToken:
 *                 type: string
 *               phoneNumbers:
 *                 type: array
 *                 items:
 *                   type: string
 *               metadata:
 *                 type: object
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Credentials updated successfully
 *       404:
 *         description: Credentials not found
 */
router.put('/:clientId/:provider', authenticateToken, auditLog, async (req, res) => {
  try {
    const { clientId, provider } = req.params;
    const updates = req.body;
    
    if (!clientId || !provider) {
      return res.status(400).json({
        success: false,
        error: 'Client ID and provider are required'
      });
    }
    
    console.log(`🔄 Updating ${provider} credentials for client ${clientId} with validation...`);
    
    // Step 1: If credentials are being updated, validate them first
    if (updates.accountSid || updates.authToken) {
      console.log(`🧪 Validating new ${provider} credentials...`);
      
      // Get current credentials to merge with updates
      const currentCredentials = await TelephonyCredentialsService.getCredentials(clientId, provider);
      
      // Prepare credentials for validation (merge current with updates)
      const credentialsToValidate = {
        accountSid: updates.accountSid || currentCredentials.accountSid,
        authToken: updates.authToken || currentCredentials.authToken
      };
      
      // Test the credentials with live API
      const validationResult = await ProviderValidationService.validateCredentials(provider, credentialsToValidate);
      
      if (!validationResult.valid) {
        console.log(`❌ ${provider} credential validation failed: ${validationResult.error}`);
        return res.status(400).json({
          success: false,
          error: `Credential validation failed: ${validationResult.error}`,
          validationError: validationResult.error,
          provider: provider
        });
      }
      
      console.log(`✅ ${provider} credentials validated successfully`);
      
      // Step 2: If phone numbers are provided, verify they exist in the account
      if (updates.phoneNumbers) {
        const phoneNumbersToVerify = Array.isArray(updates.phoneNumbers) 
          ? updates.phoneNumbers 
          : [updates.phoneNumbers];
          
        console.log(`📞 Verifying ${phoneNumbersToVerify.length} phone numbers against ${provider} account...`);
        
        if (validationResult.phoneNumbers && validationResult.phoneNumbers.length > 0) {
          const accountPhoneNumbers = validationResult.phoneNumbers.map(p => p.phoneNumber);
          const invalidNumbers = [];
          
          for (const number of phoneNumbersToVerify) {
            // Normalize phone number format for comparison
            const normalizedNumber = number.startsWith('+') ? number : `+${number}`;
            const numberExists = accountPhoneNumbers.some(accNumber => {
              const normalizedAccNumber = accNumber.startsWith('+') ? accNumber : `+${accNumber}`;
              return normalizedAccNumber === normalizedNumber;
            });
            
            if (!numberExists) {
              invalidNumbers.push(number);
            }
          }
          
          if (invalidNumbers.length > 0) {
            console.log(`❌ Invalid phone numbers for ${provider}: ${invalidNumbers.join(', ')}`);
            return res.status(400).json({
              success: false,
              error: `Phone number verification failed`,
              invalidNumbers: invalidNumbers,
              availableNumbers: accountPhoneNumbers,
              message: `These numbers don't exist in your ${provider} account: ${invalidNumbers.join(', ')}`
            });
          }
          
          console.log(`✅ All phone numbers verified against ${provider} account`);
        } else {
          console.log(`⚠️ No phone numbers found in ${provider} account, allowing update but phone numbers may not work`);
        }
      }
      
      // Add validation metadata to updates
      updates.lastValidated = new Date();
      updates.validationResult = {
        valid: true,
        testedAt: validationResult.testedAt,
        account: validationResult.account,
        phoneNumbers: validationResult.phoneNumbers || []
      };
    }
    
    // Step 3: Update credentials after validation passes
    const result = await TelephonyCredentialsService.updateCredentials(clientId, provider, updates);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    console.log(`✅ ${provider} credentials updated successfully for client ${clientId}`);
    
    // Step 4: Return success with validation info
    const response = {
      success: true,
      message: 'Telephony credentials updated successfully',
      provider: provider,
      clientId: clientId,
      validated: !!(updates.accountSid || updates.authToken),
      phoneNumbersVerified: !!updates.phoneNumbers
    };
    
    // Include account info if validation was performed
    if (updates.validationResult && updates.validationResult.account) {
      response.accountInfo = {
        name: updates.validationResult.account.friendlyName || updates.validationResult.account.name,
        status: updates.validationResult.account.status,
        phoneCount: updates.validationResult.phoneNumbers ? updates.validationResult.phoneNumbers.length : 0
      };
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error updating telephony credentials:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /telephony-credentials/{clientId}/{provider}:
 *   delete:
 *     tags: [Telephony Credentials]
 *     summary: Delete telephony credentials
 *     description: Delete telephony credentials for a client and provider
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *     responses:
 *       200:
 *         description: Credentials deleted successfully
 *       404:
 *         description: Credentials not found
 */
router.delete('/:clientId/:provider', authenticateToken, auditLog, async (req, res) => {
  try {
    const { clientId, provider } = req.params;
    
    if (!clientId || !provider) {
      return res.status(400).json({
        success: false,
        error: 'Client ID and provider are required'
      });
    }
    
    const result = await TelephonyCredentialsService.deleteCredentials(clientId, provider);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    res.json({
      success: true,
      message: 'Telephony credentials deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Error deleting telephony credentials:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /telephony-credentials/test-setup:
 *   post:
 *     tags: [Telephony Credentials]
 *     summary: Setup test credentials
 *     description: Create sample client-specific credentials for testing
 *     responses:
 *       201:
 *         description: Test credentials created successfully
 */
router.post('/test-setup', async (req, res) => {
  try {
    // Create test credentials for sample clients
    const testCredentials = [
      {
        clientId: '507f1f77bcf86cd799439011', // Sample ObjectId
        provider: 'plivo',
        accountSid: 'default_plivo_test_sid',
        authToken: 'test_plivo_token_client1',
        phoneNumbers: ['+918035735659'],
        metadata: {
          region: 'india',
          billing_enabled: true,
          client_name: 'Test Client 1'
        }
      },
      {
        clientId: '507f1f77bcf86cd799439012', // Another sample ObjectId
        provider: 'twilio',
        accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        authToken: 'test_twilio_token_client2',
        phoneNumbers: ['+18005551234'],
        metadata: {
          region: 'us-east-1',
          billing_enabled: true,
          client_name: 'Test Client 2'
        }
      }
    ];
    
    const results = [];
    for (const cred of testCredentials) {
      try {
        const result = await TelephonyCredentialsService.addCredentials(cred);
        results.push({
          clientId: cred.clientId,
          provider: cred.provider,
          success: result.success,
          error: result.error || null
        });
      } catch (error) {
        results.push({
          clientId: cred.clientId,
          provider: cred.provider,
          success: false,
          error: error.message
        });
      }
    }
    
    res.status(201).json({
      success: true,
      message: 'Test credentials setup completed',
      results
    });
    
  } catch (error) {
    console.error('❌ Error setting up test credentials:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /telephony-credentials/validate:
 *   post:
 *     tags: [Telephony Credentials]
 *     summary: Validate telephony credentials
 *     description: Validate credential format without saving
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - provider
 *               - accountSid
 *               - authToken
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *               accountSid:
 *                 type: string
 *               authToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validation result
 */
router.post('/validate', async (req, res) => {
  try {
    const { provider, accountSid, authToken } = req.body;
    
    if (!provider || !accountSid || !authToken) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: provider, accountSid, authToken'
      });
    }
    
    const validation = TelephonyCredentialsService.validateCredentials(provider, {
      accountSid,
      authToken
    });
    
    res.json({
      success: true,
      validation: validation
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
 * /telephony-credentials/{clientId}/{provider}/phone-numbers:
 *   get:
 *     tags: [Telephony Credentials]
 *     summary: List all phone numbers from provider account
 *     description: Fetches all available phone numbers from the provider account using stored credentials
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ObjectId
 *         example: "688d42040633f48913672d43"
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [plivo, twilio, wati]
 *         description: Provider name
 *         example: "twilio"
 *     responses:
 *       200:
 *         description: Phone numbers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 provider:
 *                   type: string
 *                 phoneNumbers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       phoneNumber:
 *                         type: string
 *                       friendlyName:
 *                         type: string
 *                       capabilities:
 *                         type: object
 *                       status:
 *                         type: string
 *                 account:
 *                   type: object
 *                 totalCount:
 *                   type: number
 *       404:
 *         description: Credentials not found or provider not supported
 *       500:
 *         description: Error fetching phone numbers
 */
router.get('/:clientId/:provider/phone-numbers', authenticateToken, auditLog, async (req, res) => {
  try {
    const { clientId, provider } = req.params;
    
    if (!clientId || !provider) {
      return res.status(400).json({
        success: false,
        error: 'Client ID and provider are required'
      });
    }
    
    // Check if provider supports phone number listing
    const supportedProviders = ['twilio', 'plivo'];
    if (!supportedProviders.includes(provider.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Phone number listing not supported for provider: ${provider}. Supported providers: ${supportedProviders.join(', ')}`
      });
    }
    
    console.log(`📞 Fetching ${provider} phone numbers for client ${clientId}...`);
    
    // Get client's credentials for the provider
    const credentials = await TelephonyCredentialsService.getCredentials(clientId, provider);
    
    // ONLY allow client-specific credentials - don't expose system default phone numbers
    if (!credentials || !credentials.isClientSpecific) {
      return res.status(404).json({
        success: false,
        error: `No ${provider} credentials found for client ${clientId}. Please add your ${provider} credentials first.`,
        suggestion: `Use PUT /telephony-credentials/${clientId}/${provider} to add your credentials`
      });
    }
    
    // If credentials exist, fetch phone numbers directly without validation
    // (validation was already done when credentials were saved)
    let validationResult;
    
    try {
      console.log(`🔍 DEBUG - About to validate credentials for ${provider}`);
      console.log(`🔍 DEBUG - Credentials object:`, JSON.stringify(credentials, null, 2));
      console.log(`🔍 DEBUG - AccountSid available:`, !!credentials.accountSid);
      console.log(`🔍 DEBUG - AuthToken available:`, !!credentials.authToken);
      
      validationResult = await ProviderValidationService.validateCredentials(provider, credentials);
      
      if (!validationResult.valid) {
        console.log(`⚠️ ${provider} credentials may be invalid, but attempting to fetch phone numbers anyway...`);
        
        // If validation fails, still try to return any stored phone numbers from credentials
        const storedPhoneNumbers = credentials.phoneNumbers || credentials.credentials?.phoneNumbers || [];
        let phoneNumbersArray = [];
        
        if (typeof storedPhoneNumbers === 'string') {
          phoneNumbersArray = storedPhoneNumbers.split(',').map(num => ({
            phoneNumber: num.trim(),
            friendlyName: 'Stored Number',
            capabilities: { voice: true, sms: true },
            status: 'unknown',
            source: 'stored'
          }));
        } else if (Array.isArray(storedPhoneNumbers)) {
          phoneNumbersArray = storedPhoneNumbers.map(num => ({
            phoneNumber: typeof num === 'string' ? num : num.phoneNumber,
            friendlyName: typeof num === 'string' ? 'Stored Number' : (num.friendlyName || 'Stored Number'),
            capabilities: typeof num === 'string' ? { voice: true, sms: true } : (num.capabilities || { voice: true, sms: true }),
            status: typeof num === 'string' ? 'unknown' : (num.status || 'unknown'),
            source: 'stored'
          }));
        }
        
        if (phoneNumbersArray.length > 0) {
          console.log(`📞 Using ${phoneNumbersArray.length} stored phone numbers for ${provider}`);
          
          return res.json({
            success: true,
            provider: provider,
            clientId: clientId,
            phoneNumbers: phoneNumbersArray,
            totalCount: phoneNumbersArray.length,
            account: {
              name: 'Stored Account',
              status: 'unknown',
              note: 'Live validation failed, showing stored numbers'
            },
            credentialsSource: 'client-specific',
            validationStatus: 'failed-using-stored',
            fetchedAt: new Date().toISOString(),
            warning: `Live ${provider} validation failed: ${validationResult.error}`
          });
        }
        
        // If no stored numbers and validation failed, return error
        return res.status(400).json({
          success: false,
          error: `Cannot fetch ${provider} phone numbers: ${validationResult.error}`,
          credentialsValid: false,
          suggestion: 'Please update your credentials or check your account status'
        });
      }
    } catch (validationError) {
      console.error(`❌ Error during ${provider} validation:`, validationError);
      
      // Fallback to stored phone numbers if validation throws error
      const storedPhoneNumbers = credentials.phoneNumbers || credentials.credentials?.phoneNumbers || [];
      if (storedPhoneNumbers && storedPhoneNumbers.length > 0) {
        let phoneNumbersArray = [];
        
        if (typeof storedPhoneNumbers === 'string') {
          phoneNumbersArray = storedPhoneNumbers.split(',').map(num => ({
            phoneNumber: num.trim(),
            friendlyName: 'Stored Number',
            capabilities: { voice: true, sms: true },
            status: 'stored'
          }));
        } else if (Array.isArray(storedPhoneNumbers)) {
          phoneNumbersArray = storedPhoneNumbers.map(num => ({
            phoneNumber: typeof num === 'string' ? num : num.phoneNumber,
            friendlyName: 'Stored Number',
            capabilities: { voice: true, sms: true },
            status: 'stored'
          }));
        }
        
        return res.json({
          success: true,
          provider: provider,
          clientId: clientId,
          phoneNumbers: phoneNumbersArray,
          totalCount: phoneNumbersArray.length,
          account: {
            name: 'Stored Account',
            status: 'validation-error'
          },
          credentialsSource: 'client-specific',
          validationStatus: 'error-using-stored',
          fetchedAt: new Date().toISOString(),
          warning: `Validation error, showing stored numbers: ${validationError.message}`
        });
      }
      
      return res.status(500).json({
        success: false,
        error: `Error validating ${provider} credentials: ${validationError.message}`,
        suggestion: 'Please check your credentials or try again later'
      });
    }
    
    console.log(`✅ Successfully fetched ${validationResult.phoneNumbers?.length || 0} ${provider} phone numbers`);
    
    // Format response
    const response = {
      success: true,
      provider: provider,
      clientId: clientId,
      phoneNumbers: validationResult.phoneNumbers || [],
      totalCount: validationResult.phoneNumbers?.length || 0,
      account: {
        name: validationResult.account?.friendlyName || validationResult.account?.name || 'Unknown',
        status: validationResult.account?.status || 'Unknown',
        ...(validationResult.balance && { balance: validationResult.balance })
      },
      credentialsSource: 'client-specific',
      fetchedAt: new Date().toISOString()
    };
    
    // Add provider-specific information
    if (provider === 'twilio' && validationResult.account) {
      response.account.type = validationResult.account.type;
      response.account.sid = validationResult.account.sid;
    }
    
    res.json(response);
    
  } catch (error) {
    console.error(`❌ Error fetching ${req.params.provider} phone numbers:`, error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching phone numbers',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /telephony-credentials/available-providers:
 *   get:
 *     tags: [Telephony Credentials]
 *     summary: Get list of providers that support phone number listing
 *     description: Returns providers that support fetching phone numbers from their accounts
 *     responses:
 *       200:
 *         description: List of supported providers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 providers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       supportsPhoneNumbers:
 *                         type: boolean
 *                       capabilities:
 *                         type: array
 */
router.get('/available-providers', (req, res) => {
  try {
    const providers = [
      {
        name: 'twilio',
        displayName: 'Twilio Communications',
        supportsPhoneNumbers: true,
        capabilities: ['voice', 'sms', 'whatsapp'],
        description: 'Fetches phone numbers, capabilities, and account balance'
      },
      {
        name: 'plivo',
        displayName: 'Plivo Voice & SMS',
        supportsPhoneNumbers: true,
        capabilities: ['voice', 'sms'],
        description: 'Fetches phone numbers and regions'
      },
      {
        name: 'wati',
        displayName: 'WATI WhatsApp Business',
        supportsPhoneNumbers: false,
        capabilities: ['whatsapp'],
        description: 'WhatsApp Business API (no phone number listing)'
      }
    ];
    
    res.json({
      success: true,
      providers: providers,
      supportedForPhoneNumbers: providers.filter(p => p.supportsPhoneNumbers)
    });
    
  } catch (error) {
    console.error('❌ Error getting available providers:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;