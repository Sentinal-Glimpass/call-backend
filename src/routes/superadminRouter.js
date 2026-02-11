const express = require('express');
const router = express.Router();
const { authenticateSuperKey } = require('../middleware/authMiddleware');
const {
  insertClient,
  getAllClients,
  getClientByClientId,
  updateClient,
  insertAssistant,
  getAllAssistants,
  getAssistantByClientId,
  updateAssistant,
  getAssistantDetails
} = require('../apps/interLogue/client');
const { initiatePlivoCall, getCurrentClientBalance } = require('../apps/plivo/plivo');
const { connectToMongo, client } = require('../../models/mongodb.js');

/**
 * @swagger
 * tags:
 *   name: Superadmin
 *   description: Superadmin operations for managing clients, assistants, and system-wide settings
 */

// All routes require Super Key authentication
router.use(authenticateSuperKey);

// ==================== CLIENT MANAGEMENT ====================

/**
 * @swagger
 * /superadmin/clients:
 *   get:
 *     summary: Get all clients
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of all clients
 */
router.get('/clients', async (req, res) => {
  try {
    const result = await getAllClients();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch clients', error: error.message });
  }
});

/**
 * @swagger
 * /superadmin/clients/{clientId}:
 *   get:
 *     summary: Get client by ID
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Client details
 */
router.get('/clients/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const result = await getClientByClientId(clientId);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch client', error: error.message });
  }
});

/**
 * @swagger
 * /superadmin/clients:
 *   post:
 *     summary: Create a new client
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               tokens:
 *                 type: number
 *     responses:
 *       201:
 *         description: Client created successfully
 */
router.post('/clients', async (req, res) => {
  try {
    const clientData = {
      ...req.body,
      tokens: req.body.tokens || 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await insertClient(clientData);
    res.status(result.status).json({ success: result.status < 300, message: result.message });
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ success: false, message: 'Failed to create client', error: error.message });
  }
});

/**
 * @swagger
 * /superadmin/clients/{clientId}:
 *   put:
 *     summary: Update a client
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Client updated successfully
 */
router.put('/clients/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const newDocs = { ...req.body, updatedAt: new Date() };
    const result = await updateClient(clientId, newDocs);
    res.status(200).json({ success: true, message: 'Client updated successfully', data: result });
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ success: false, message: 'Failed to update client', error: error.message });
  }
});

// ==================== ASSISTANT MANAGEMENT ====================

/**
 * @swagger
 * /superadmin/assistants:
 *   get:
 *     summary: Get all assistants
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of all assistants
 */
router.get('/assistants', async (req, res) => {
  try {
    const result = await getAllAssistants();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching assistants:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assistants', error: error.message });
  }
});

/**
 * @swagger
 * /superadmin/assistants/client/{clientId}:
 *   get:
 *     summary: Get assistants by client ID
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of assistants for the client
 */
router.get('/assistants/client/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const result = await getAssistantByClientId(clientId, 0); // 0 = not a client request (admin)
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching assistants by client:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assistants', error: error.message });
  }
});

/**
 * @swagger
 * /superadmin/assistants/{assistantId}:
 *   get:
 *     summary: Get assistant details by ID
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: assistantId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assistant details
 */
router.get('/assistants/:assistantId', async (req, res) => {
  try {
    const { assistantId } = req.params;
    const result = await getAssistantDetails(assistantId);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Assistant not found' });
    }
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching assistant:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assistant', error: error.message });
  }
});

/**
 * @swagger
 * /superadmin/assistants:
 *   post:
 *     summary: Create a new assistant
 *     tags: [Superadmin]
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
 *               - agent_name
 *             properties:
 *               clientId:
 *                 type: string
 *               agent_name:
 *                 type: string
 *               wssUrl:
 *                 type: string
 *               system_prompt:
 *                 type: string
 *               agent_welcome_message:
 *                 type: string
 *     responses:
 *       201:
 *         description: Assistant created successfully
 */
router.post('/assistants', async (req, res) => {
  try {
    const assistantData = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await insertAssistant(assistantData);
    res.status(result.status).json({
      success: result.status < 300,
      message: 'Assistant created successfully',
      data: { _id: result.id }
    });
  } catch (error) {
    console.error('Error creating assistant:', error);
    res.status(500).json({ success: false, message: 'Failed to create assistant', error: error.message });
  }
});

/**
 * @swagger
 * /superadmin/assistants/{assistantId}:
 *   put:
 *     summary: Update an assistant
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: assistantId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Assistant updated successfully
 */
router.put('/assistants/:assistantId', async (req, res) => {
  try {
    const { assistantId } = req.params;
    const newDocs = { ...req.body, updatedAt: new Date() };
    const result = await updateAssistant(assistantId, newDocs, 0); // 0 = admin request
    res.status(200).json({ success: true, message: 'Assistant updated successfully', data: result });
  } catch (error) {
    console.error('Error updating assistant:', error);
    res.status(500).json({ success: false, message: 'Failed to update assistant', error: error.message });
  }
});

// ==================== BALANCE/BILLING ====================

/**
 * @swagger
 * /superadmin/balance/{clientId}:
 *   get:
 *     summary: Get client balance
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Client balance
 */
router.get('/balance/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const result = await getCurrentClientBalance(clientId);
    res.status(200).json({ success: true, data: { balance: result } });
  } catch (error) {
    console.error('Error fetching balance:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch balance', error: error.message });
  }
});

/**
 * @swagger
 * /superadmin/balance/{clientId}:
 *   put:
 *     summary: Update client balance (add/subtract tokens)
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tokens
 *             properties:
 *               tokens:
 *                 type: number
 *                 description: New token balance
 *     responses:
 *       200:
 *         description: Balance updated successfully
 */
router.put('/balance/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { tokens } = req.body;
    const result = await updateClient(clientId, { tokens, updatedAt: new Date() });
    res.status(200).json({ success: true, message: 'Balance updated successfully', data: result });
  } catch (error) {
    console.error('Error updating balance:', error);
    res.status(500).json({ success: false, message: 'Failed to update balance', error: error.message });
  }
});

/**
 * @swagger
 * /superadmin/billing/{clientId}:
 *   get:
 *     summary: Get billing history for a client
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Billing history
 */
router.get('/billing/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("billing");

    const billingHistory = await collection
      .find({ clientId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.status(200).json({ success: true, data: billingHistory });
  } catch (error) {
    console.error('Error fetching billing history:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch billing history', error: error.message });
  }
});

// ==================== SINGLE CALL ====================

/**
 * @swagger
 * /superadmin/single-call:
 *   post:
 *     summary: Initiate a single call
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
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
 *             properties:
 *               from:
 *                 type: string
 *                 description: Caller phone number
 *               to:
 *                 type: string
 *                 description: Recipient phone number
 *               wssUrl:
 *                 type: string
 *                 description: WebSocket URL for voice processing
 *               clientId:
 *                 type: string
 *                 description: Client ID (optional - defaults to SUPERADMIN for billing)
 *               assistantId:
 *                 type: string
 *                 description: Assistant ID (optional)
 *     responses:
 *       200:
 *         description: Call initiated successfully
 */
router.post('/single-call', async (req, res) => {
  try {
    const { from, to, wssUrl, clientId, assistantId } = req.body;

    if (!from || !to || !wssUrl) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: from, to, wssUrl'
      });
    }

    // Use 'SUPERADMIN' as billing identifier if no clientId provided
    const billingClientId = clientId || 'SUPERADMIN';

    // Warmup the bot pod before making the call
    const { warmupBotWithRetry } = require('../../utils/botWarmup.js');
    const warmupEnabled = process.env.BOT_WARMUP_ENABLED !== 'false';

    if (warmupEnabled && wssUrl) {
      try {
        const wsUrl = new URL(wssUrl);
        const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
        const botWarmupUrl = `${protocol}//${wsUrl.host}/warmup`;
        console.log(`🤖 Superadmin: warming up bot at ${botWarmupUrl}`);
        const warmupResult = await warmupBotWithRetry(botWarmupUrl);
        if (!warmupResult.success) {
          console.warn(`⚠️ Bot warmup failed but proceeding with call: ${warmupResult.error}`);
        } else {
          console.log(`✅ Bot warmup done (${warmupResult.duration}ms, ${warmupResult.attempts} attempts)`);
        }
      } catch (warmupError) {
        console.warn(`⚠️ Bot warmup error (proceeding anyway): ${warmupError.message}`);
      }
    }

    const result = await initiatePlivoCall(from, to, wssUrl, billingClientId, assistantId);
    res.status(200).json({ success: true, message: 'Call initiated', data: result });
  } catch (error) {
    console.error('Error initiating call:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate call', error: error.message });
  }
});

// ==================== DASHBOARD STATS ====================

/**
 * @swagger
 * /superadmin/stats:
 *   get:
 *     summary: Get dashboard statistics
 *     tags: [Superadmin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics
 */
router.get('/stats', async (req, res) => {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");

    const [clientCount, assistantCount] = await Promise.all([
      database.collection("client").countDocuments(),
      database.collection("assistant").countDocuments()
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalClients: clientCount,
        totalAssistants: assistantCount
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats', error: error.message });
  }
});

module.exports = router;
