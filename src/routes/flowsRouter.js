const express = require('express');
const router = express.Router();
const axios = require('axios');
const {
  authenticateToken,
  validateResourceOwnership,
  auditLog
} = require('../middleware/authMiddleware');
const { getFlowRedisClient, scanRedisKeys } = require('../utils/flowRedisClient');

/**
 * @swagger
 * tags:
 *   name: Flows
 *   description: Flow-based agent conversation management API
 */

/**
 * @swagger
 * /api/flows/agent/{agentId}:
 *   get:
 *     tags: [Flows]
 *     summary: Check if agent has flow assigned
 *     description: Retrieves flow assignment for a specific agent from the uniPipe system
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: The agent/assistant ID
 *         example: "69320c340633f489136754ef"
 *     responses:
 *       200:
 *         description: Flow assignment retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasFlow:
 *                   type: boolean
 *                   description: Whether the agent has a flow assigned
 *                 flowName:
 *                   type: string
 *                   nullable: true
 *                   description: Name of the assigned flow (e.g., "neetprep_lead_qualifier")
 *                 flowPath:
 *                   type: string
 *                   nullable: true
 *                   description: Full path to the flow (e.g., "production/neetprep_lead_qualifier")
 *                 description:
 *                   type: string
 *                   nullable: true
 *                   description: Description of the flow
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       500:
 *         description: Internal server error
 */
router.get('/agent/:agentId', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const { agentId } = req.params;

        // Try to get flow assignment from uniPipe server
        const uniPipeUrl = process.env.UNIPIPE_SERVER_URL || 'https://testbot.glimpass.com';

        try {
            // First try the uniPipe API endpoint
            const response = await axios.get(`${uniPipeUrl}/flows/agent/${agentId}`, {
                timeout: 5000,
                validateStatus: (status) => status < 500 // Accept 404 as valid response
            });

            if (response.status === 200 && response.data) {
                const flowData = response.data;
                return res.json({
                    hasFlow: true,
                    flowName: flowData.flow ? flowData.flow.split('/').pop() : null,
                    flowPath: flowData.flow || null,
                    description: flowData.description || null
                });
            }
        } catch (apiError) {
            console.log(`Could not reach uniPipe API, falling back to local flow_mapping.json: ${apiError.message}`);
        }

        // Fallback: Read flow_mapping.json directly
        try {
            const fs = require('fs');
            const path = require('path');
            const flowMappingPath = path.join(process.env.UNIPIPE_PATH || '/home/rishi/uniPipe', 'flows/flow_mapping.json');

            if (fs.existsSync(flowMappingPath)) {
                const flowMapping = JSON.parse(fs.readFileSync(flowMappingPath, 'utf8'));
                const mapping = flowMapping.mappings?.[agentId] || flowMapping.mappings?.[`test_${agentId}`];

                if (mapping) {
                    return res.json({
                        hasFlow: true,
                        flowName: mapping.flow ? mapping.flow.split('/').pop() : null,
                        flowPath: mapping.flow || null,
                        description: mapping.description || null
                    });
                }
            }
        } catch (fileError) {
            console.error(`Error reading flow_mapping.json: ${fileError.message}`);
        }

        // No flow found
        res.json({
            hasFlow: false,
            flowName: null,
            flowPath: null,
            description: null
        });

    } catch (error) {
        console.error('Error checking agent flow:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve agent flow assignment'
        });
    }
});

/**
 * @swagger
 * /api/flows/{flowName}:
 *   get:
 *     tags: [Flows]
 *     summary: Get flow data (prompts and configs)
 *     description: Retrieves all prompts, configs, and metadata for a specific flow from Redis db=3
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flowName
 *         required: true
 *         schema:
 *           type: string
 *         description: The flow name (without directory prefix)
 *         example: "neetprep_lead_qualifier"
 *     responses:
 *       200:
 *         description: Flow data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   description: Flow name
 *                 meta:
 *                   type: object
 *                   description: Flow metadata
 *                 prompts:
 *                   type: object
 *                   description: Map of prompt names to their content
 *                 configs:
 *                   type: object
 *                   description: Map of config names to their values
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       404:
 *         description: Flow not found
 *       500:
 *         description: Internal server error
 */
router.get('/:flowName', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const { flowName } = req.params;
        const redisClient = await getFlowRedisClient();

        // Get flow metadata
        let meta = null;
        try {
            const metaKey = `flow:${flowName}:meta`;
            const metaData = await redisClient.get(metaKey);
            if (metaData) {
                meta = JSON.parse(metaData);
            }
        } catch (metaError) {
            console.warn(`Could not parse flow metadata: ${metaError.message}`);
        }

        // Get all prompts
        const prompts = {};
        const promptPattern = `flow:${flowName}:prompt:*`;
        const promptKeys = await scanRedisKeys(redisClient, promptPattern);

        for (const key of promptKeys) {
            const promptName = key.split(':').pop();
            const content = await redisClient.get(key);
            if (content) {
                prompts[promptName] = content;
            }
        }

        // Get all configs
        const configs = {};
        const configPattern = `flow:${flowName}:config:*`;
        const configKeys = await scanRedisKeys(redisClient, configPattern);

        for (const key of configKeys) {
            const configName = key.split(':').pop();
            const value = await redisClient.get(key);
            if (value) {
                configs[configName] = value;
            }
        }

        // Check if flow exists
        if (!meta && Object.keys(prompts).length === 0 && Object.keys(configs).length === 0) {
            return res.status(404).json({
                error: 'Flow not found',
                message: `No data found for flow: ${flowName}`
            });
        }

        res.json({
            name: flowName,
            meta: meta,
            prompts: prompts,
            configs: configs
        });

    } catch (error) {
        console.error('Error getting flow data:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve flow data'
        });
    }
});

/**
 * @swagger
 * /api/flows/{flowName}/prompts/{promptName}:
 *   put:
 *     tags: [Flows]
 *     summary: Update a flow prompt
 *     description: Updates a specific prompt for a flow in Redis db=3
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flowName
 *         required: true
 *         schema:
 *           type: string
 *         description: The flow name
 *         example: "neetprep_lead_qualifier"
 *       - in: path
 *         name: promptName
 *         required: true
 *         schema:
 *           type: string
 *         description: The prompt name
 *         example: "role_prompt"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: The new prompt content
 *     responses:
 *       200:
 *         description: Prompt updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 key:
 *                   type: string
 *       400:
 *         description: Bad request - Missing content
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       500:
 *         description: Internal server error
 */
router.put('/:flowName/prompts/:promptName', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const { flowName, promptName } = req.params;
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'Prompt content is required'
            });
        }

        const redisClient = await getFlowRedisClient();
        const key = `flow:${flowName}:prompt:${promptName}`;

        await redisClient.set(key, content);

        res.json({
            success: true,
            message: 'Prompt updated successfully',
            key: key
        });

    } catch (error) {
        console.error('Error updating prompt:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to update prompt'
        });
    }
});

/**
 * @swagger
 * /api/flows/{flowName}/configs/{configName}:
 *   put:
 *     tags: [Flows]
 *     summary: Update a flow config
 *     description: Updates a specific config value for a flow in Redis db=3
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flowName
 *         required: true
 *         schema:
 *           type: string
 *         description: The flow name
 *         example: "neetprep_lead_qualifier"
 *       - in: path
 *         name: configName
 *         required: true
 *         schema:
 *           type: string
 *         description: The config name
 *         example: "counselor_number"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *             properties:
 *               value:
 *                 type: string
 *                 description: The new config value
 *     responses:
 *       200:
 *         description: Config updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 key:
 *                   type: string
 *       400:
 *         description: Bad request - Missing value
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       500:
 *         description: Internal server error
 */
router.put('/:flowName/configs/:configName', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const { flowName, configName } = req.params;
        const { value } = req.body;

        if (value === undefined || value === null) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'Config value is required'
            });
        }

        const redisClient = await getFlowRedisClient();
        const key = `flow:${flowName}:config:${configName}`;

        await redisClient.set(key, value.toString());

        res.json({
            success: true,
            message: 'Config updated successfully',
            key: key
        });

    } catch (error) {
        console.error('Error updating config:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to update config'
        });
    }
});

module.exports = router;
