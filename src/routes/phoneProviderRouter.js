/**
 * Phone Provider Management Router
 * API endpoints for managing phone number to provider mappings
 */

const express = require('express');
const router = express.Router();
const PhoneProviderService = require('../services/phoneProviderService');
const { 
  authenticateToken, 
  validateResourceOwnership, 
  auditLog 
} = require('../middleware/authMiddleware');
const { 
  createValidationMiddleware 
} = require('../middleware/validationMiddleware');

/**
 * @swagger
 * tags:
 *   name: Phone Provider
 *   description: Phone number to provider mapping management
 */

// Validation schemas
const validationSchemas = {
  addProvider: createValidationMiddleware({
    body: {
      phoneNumber: {
        required: true,
        validate: 'isValidPhone',
        sanitize: 'sanitizePhone'
      },
      provider: {
        required: true,
        validate: (value) => ['plivo', 'twilio'].includes(value) || 'Provider must be plivo or twilio',
        sanitize: 'sanitizeString'
      },
      providerConfig: {
        required: true,
        validate: (value) => typeof value === 'object' || 'Provider config must be an object'
      }
    }
  })
};

/**
 * @swagger
 * /phone-provider/test-call:
 *   post:
 *     tags: [Phone Provider]
 *     summary: Test call routing (simulation mode)
 *     description: Test which provider would be used for a call without making actual API calls
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - from
 *               - to
 *               - wssUrl
 *               - clientId
 *             properties:
 *               from:
 *                 type: string
 *                 example: "+918035735659"
 *               to:
 *                 type: string
 *                 example: "+919608848421"
 *               wssUrl:
 *                 type: string
 *                 example: "wss://connect.glimpass.com/chat/v2/test-uuid"
 *               clientId:
 *                 type: string
 *               firstName:
 *                 type: string
 *               tag:
 *                 type: string
 *     responses:
 *       200:
 *         description: Call routing simulation result
 */
router.post('/test-call', async (req, res) => {
  try {
    const { from, to, wssUrl, clientId, firstName, tag } = req.body;
    
    if (!from || !to || !wssUrl || !clientId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: from, to, wssUrl, clientId'
      });
    }
    
    // Import CallProviderService
    const CallProviderService = require('../services/callProviderService');
    
    // Validate call parameters
    const validation = CallProviderService.validateCallParams(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }
    
    // Get provider info
    const providerInfo = await PhoneProviderService.getProvider(from);
    
    res.json({
      success: true,
      simulation: true,
      callParams: {
        from,
        to,
        wssUrl,
        clientId,
        firstName: firstName || '',
        tag: tag || ''
      },
      routing: {
        provider: providerInfo.provider,
        isDefault: providerInfo.isDefault || false,
        accountSid: providerInfo.providerConfig?.accountSid || 'hidden'
      },
      message: `Call would be routed to ${providerInfo.provider.toUpperCase()}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in call routing test:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /phone-provider/test/{phoneNumber}:
 *   get:
 *     tags: [Phone Provider]
 *     summary: Test provider lookup (no auth required)
 *     description: Test endpoint to lookup provider for a phone number
 *     parameters:
 *       - in: path
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *         example: "+918035735659"
 *     responses:
 *       200:
 *         description: Provider configuration found
 */
router.get('/test/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }
    
    const provider = await PhoneProviderService.getProvider(phoneNumber);
    
    res.json({
      success: true,
      phoneNumber: provider.phoneNumber,
      provider: provider.provider,
      isDefault: provider.isDefault || false,
      isActive: provider.isActive,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in test provider lookup:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /phone-provider/lookup/{phoneNumber}:
 *   get:
 *     tags: [Phone Provider]
 *     summary: Get provider configuration for a phone number
 *     description: Returns the provider (Plivo/Twilio) and configuration for a phone number
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number to lookup (with or without + prefix)
 *         example: "+918035735659"
 *     responses:
 *       200:
 *         description: Provider configuration found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 phoneNumber:
 *                   type: string
 *                 provider:
 *                   type: string
 *                   enum: [plivo, twilio]
 *                 providerConfig:
 *                   type: object
 *                 isDefault:
 *                   type: boolean
 *       400:
 *         description: Invalid phone number
 *       401:
 *         description: Unauthorized
 */
router.get('/lookup/:phoneNumber', authenticateToken, auditLog, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }
    
    const provider = await PhoneProviderService.getProvider(phoneNumber);
    
    res.json({
      success: true,
      phoneNumber: provider.phoneNumber,
      provider: provider.provider,
      providerConfig: provider.providerConfig,
      isDefault: provider.isDefault || false,
      isActive: provider.isActive
    });
    
  } catch (error) {
    console.error('❌ Error in provider lookup:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /phone-provider/add:
 *   post:
 *     tags: [Phone Provider]
 *     summary: Add a new phone number to provider mapping
 *     description: Maps a phone number to a specific provider (Plivo or Twilio)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - provider
 *               - providerConfig
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 example: "+918035735659"
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *                 example: "twilio"
 *               providerConfig:
 *                 type: object
 *                 example:
 *                   accountSid: "AC1234567890"
 *                   authToken: "your_auth_token"
 *     responses:
 *       201:
 *         description: Provider mapping created successfully
 *       400:
 *         description: Invalid input or phone number already exists
 *       401:
 *         description: Unauthorized
 */
router.post('/add', authenticateToken, validationSchemas.addProvider, auditLog, async (req, res) => {
  try {
    const { phoneNumber, provider, providerConfig } = req.body;
    
    const result = await PhoneProviderService.addProvider({
      phoneNumber,
      provider,
      providerConfig
    });
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.status(201).json({
      success: true,
      message: 'Provider mapping created successfully',
      id: result.id,
      phoneNumber: result.mapping.phoneNumber,
      provider: result.mapping.provider
    });
    
  } catch (error) {
    console.error('❌ Error adding provider:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /phone-provider/list:
 *   get:
 *     tags: [Phone Provider]
 *     summary: List all provider mappings
 *     description: Returns a list of all phone number to provider mappings
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *         description: Filter by provider
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of results
 *     responses:
 *       200:
 *         description: List of provider mappings
 *       401:
 *         description: Unauthorized
 */
router.get('/list', authenticateToken, auditLog, async (req, res) => {
  try {
    const { provider, limit } = req.query;
    
    const options = {};
    if (provider) options.provider = provider;
    if (limit) options.limit = parseInt(limit);
    
    const mappings = await PhoneProviderService.listProviders(options);
    
    res.json({
      success: true,
      count: mappings.length,
      mappings: mappings.map(m => ({
        id: m._id,
        phoneNumber: m.phoneNumber,
        provider: m.provider,
        isActive: m.isActive,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt
      }))
    });
    
  } catch (error) {
    console.error('❌ Error listing providers:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /phone-provider/update/{phoneNumber}:
 *   put:
 *     tags: [Phone Provider]
 *     summary: Update provider configuration for a phone number
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *               providerConfig:
 *                 type: object
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Provider mapping updated successfully
 *       404:
 *         description: Phone number not found
 */
router.put('/update/:phoneNumber', authenticateToken, auditLog, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const updates = req.body;
    
    const result = await PhoneProviderService.updateProvider(phoneNumber, updates);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    res.json({
      success: true,
      message: 'Provider mapping updated successfully'
    });
    
  } catch (error) {
    console.error('❌ Error updating provider:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /phone-provider/delete/{phoneNumber}:
 *   delete:
 *     tags: [Phone Provider]
 *     summary: Delete a provider mapping
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Provider mapping deleted successfully
 *       404:
 *         description: Phone number not found
 */
router.delete('/delete/:phoneNumber', authenticateToken, auditLog, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    
    const result = await PhoneProviderService.deleteProvider(phoneNumber);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    res.json({
      success: true,
      message: 'Provider mapping deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Error deleting provider:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /phone-provider/test-setup:
 *   post:
 *     tags: [Phone Provider]
 *     summary: Setup test data for provider mapping
 *     description: Creates sample provider mappings for testing
 *     responses:
 *       201:
 *         description: Test data created successfully
 */
router.post('/test-setup', async (req, res) => {
  try {
    // Create test mappings
    const testMappings = [
      {
        phoneNumber: '+918035735659',
        provider: 'plivo',
        providerConfig: {
          accountSid: 'MAMTBIYJUYNMRINGQ4ND',
          authToken: process.env.PLIVO_AUTH_TOKEN || 'test_token'
        }
      },
      {
        phoneNumber: '+919876543210',
        provider: 'twilio',
        providerConfig: {
          accountSid: process.env.TWILIO_ACCOUNT_SID || 'AC_test_sid',
          authToken: process.env.TWILIO_AUTH_TOKEN || 'test_token'
        }
      }
    ];
    
    const results = [];
    for (const mapping of testMappings) {
      const result = await PhoneProviderService.addProvider(mapping);
      results.push({
        phoneNumber: mapping.phoneNumber,
        provider: mapping.provider,
        success: result.success,
        error: result.error
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Test data setup completed',
      results
    });
    
  } catch (error) {
    console.error('❌ Error setting up test data:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;