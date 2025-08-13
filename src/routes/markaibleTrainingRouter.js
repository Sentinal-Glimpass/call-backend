const express = require('express');
const router = express.Router();
const { groqClient } = require('../utils/groqClient');
const { createClient } = require('redis');
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
 *   name: MarkAible Training
 *   description: AI prompt training and refinement interface
 */

// Validation schemas
const validationSchemas = {
  chatRequest: createValidationMiddleware({
    body: {
      prompt: {
        required: true,
        sanitize: 'sanitizeString',
        minLength: 10,
        maxLength: 10000
      },
      question: {
        required: true,
        sanitize: 'sanitizeString',
        minLength: 1,
        maxLength: 1000
      },
      assistantName: {
        required: false,
        sanitize: 'sanitizeString',
        maxLength: 100
      },
      assistantId: {
        required: false,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      }
    }
  }),
  
  promptUpdate: createValidationMiddleware({
    body: {
      assistantId: {
        required: true,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      },
      updatedPrompt: {
        required: true,
        sanitize: 'sanitizeString',
        minLength: 10,
        maxLength: 10000
      }
    }
  }),
  
  clearCache: createValidationMiddleware({
    body: {
      agentId: {
        required: true,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      },
      confirm: {
        required: true,
        validate: (value) => value === true || 'Confirmation required: set confirm to true'
      }
    }
  })
};

/**
 * @swagger
 * /api/train-ai/chat:
 *   post:
 *     tags: [MarkAible Training]
 *     summary: Interactive chat for prompt refinement
 *     description: Chat with AI assistant to improve and refine voice agent prompts
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *               - question
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: Current prompt content to analyze
 *                 example: "You are Priya, a female voice agent..."
 *               question:
 *                 type: string
 *                 description: Question or request for prompt improvement
 *                 example: "Make the greeting more friendly"
 *               assistantId:
 *                 type: string
 *                 description: Optional assistant identifier
 *               assistantName:
 *                 type: string
 *                 description: Name of the AI assistant
 *                 example: "PromptTrainer"
 *     responses:
 *       200:
 *         description: Chat response with prompt suggestions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 response:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [changes, answer]
 *                     analysis:
 *                       type: string
 *                     changes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           original:
 *                             type: string
 *                           suggested:
 *                             type: string
 *                           explanation:
 *                             type: string
 *                     content:
 *                       type: string
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/chat', authenticateToken, validateResourceOwnership, validationSchemas.chatRequest, auditLog, async (req, res) => {
  try {
    const { prompt, question, assistantId, assistantName } = req.body;

    console.log('Processing chat request:', { assistantName, question });
    
    const completion = await groqClient.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are ${assistantName || 'PromptTrainer'}, an AI assistant helping to improve system prompts. When suggesting changes:
1. Analyze the current prompt content
2. Return your response in JSON format with these fields:
   For changes to the prompt:
   {
     "type": "changes",
     "analysis": "Brief explanation of overall changes",
     "changes": [
       {
         "original": "Exact text to change",
         "suggested": "New text to replace it with",
         "explanation": "Why this change is better"
       }
     ]
   }
   
   For general responses:
   {
     "type": "answer",
     "content": "Your response here"
   }`
        },
        {
          role: 'system',
          content: prompt
        },
        {
          role: 'user',
          content: question
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 4096,
    });

    let response = completion.choices[0]?.message?.content;
    console.log('Raw AI response:', response);

    if (!response) {
      throw new Error('No response received from AI');
    }

    try {
      response = JSON.parse(response);
      console.log('Parsed response:', response);
    } catch (e) {
      console.error('JSON parse error:', e);
      console.log('Attempting to clean response...');
      
      // Clean the response string
      response = response
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/\\"/g, '"')
        .replace(/\\/g, '\\\\')
        .replace(/^"/, '')
        .replace(/"$/, '');

      try {
        response = {
          type: 'answer',
          content: response
        };
      } catch (e2) {
        console.error('Failed to create answer response:', e2);
        throw new Error('Invalid response format');
      }
    }

    res.json({ response });
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/train-ai/update-prompt:
 *   put:
 *     tags: [MarkAible Training]
 *     summary: Update AI assistant prompt
 *     description: Update the prompt content for a specific AI assistant
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - assistantId
 *               - updatedPrompt
 *             properties:
 *               assistantId:
 *                 type: string
 *                 description: MongoDB ObjectId of the assistant
 *                 example: "64f8a1b2c3d4e5f6789012ab"
 *               updatedPrompt:
 *                 type: string
 *                 description: New prompt content
 *                 example: "You are Priya, an improved voice agent..."
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
 *                   example: true
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.put('/update-prompt', authenticateToken, validateResourceOwnership, validationSchemas.promptUpdate, auditLog, async (req, res) => {
  try {
    const { assistantId, updatedPrompt } = req.body;

    // Here you would typically update the prompt in your database
    // For now, we'll just log the update
    console.log('Updating prompt for assistant:', assistantId);
    console.log('New prompt length:', updatedPrompt.length);
    
    // TODO: Implement database update logic
    // const updateResult = await updateAssistantPrompt(assistantId, updatedPrompt);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating prompt:', error);
    res.status(500).json({ error: 'Failed to update prompt' });
  }
});

/**
 * @swagger
 * /api/train-ai/clear-audio-cache:
 *   post:
 *     tags: [MarkAible Training]
 *     summary: Clear audio cache for agent
 *     description: Permanently delete all cached audio data for a specific agent from Redis
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agentId
 *               - confirm
 *             properties:
 *               agentId:
 *                 type: string
 *                 description: MongoDB ObjectId of the agent
 *                 example: "64f8a1b2c3d4e5f6789012ab"
 *               confirm:
 *                 type: boolean
 *                 description: Must be true to confirm cache deletion
 *                 example: true
 *     responses:
 *       200:
 *         description: Audio cache cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 deletedKeys:
 *                   type: number
 *       400:
 *         description: Bad request or confirmation required
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/clear-audio-cache', authenticateToken, validateResourceOwnership, validationSchemas.clearCache, auditLog, async (req, res) => {
  try {
    const { agentId } = req.body;

    console.log('Clearing audio cache for agent:', agentId);
    
    // Connect to Redis using environment configuration
    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
    const redisClient = createClient({
      url: redisUrl
    });
    
    await redisClient.connect();
    
    try {
      let deletedCount = 0;
      
      // Delete the semantic cache index for this agent
      // Based on your SemanticCache class structure: name=f'{name}_{agent_id}'
      const indexName = `audioCache_${agentId}`;
      
      try {
        // Try to drop the RediSearch index if it exists
        await redisClient.sendCommand(['FT.DROPINDEX', indexName, 'DD']);
        console.log(`Dropped RediSearch index: ${indexName}`);
        deletedCount++;
      } catch (indexError) {
        console.log(`No RediSearch index found for ${indexName} or error dropping:`, indexError.message);
      }
      
      // Clear all cache data with pattern matching for the specific agent
      const cachePatterns = [
        `audioCache_${agentId}`,
        `audioCache_${agentId}_*`,
        `audioCache_${agentId}:*`,
        `*audioCache_${agentId}*`
      ];
      
      let allKeys = [];
      for (const pattern of cachePatterns) {
        const keys = await redisClient.keys(pattern);
        allKeys = allKeys.concat(keys);
      }
      
      // Remove duplicates
      const keys = [...new Set(allKeys)];
      
      if (keys.length > 0) {
        // Delete all keys in batches
        const batchSize = 100;
        for (let i = 0; i < keys.length; i += batchSize) {
          const batch = keys.slice(i, i + batchSize);
          await redisClient.del(batch);
          deletedCount += batch.length;
        }
        
        console.log(`Deleted ${keys.length} cache entries for agent ${agentId}`);
      }
      
      // Also clear any related vector embeddings, metadata, or prefix-based keys
      const additionalPatterns = [
        `*${agentId}*vector*`,
        `*${agentId}*metadata*`,
        `*${agentId}*embedding*`,
        `prefix_audioCache_${agentId}*`
      ];
      
      for (const pattern of additionalPatterns) {
        const additionalKeys = await redisClient.keys(pattern);
        if (additionalKeys.length > 0) {
          await redisClient.del(additionalKeys);
          deletedCount += additionalKeys.length;
          console.log(`Deleted ${additionalKeys.length} additional keys matching pattern: ${pattern}`);
        }
      }
      
      console.log(`Total deleted: ${deletedCount} entries including index for agent ${agentId}`);
      
      await redisClient.disconnect();
      
      res.json({ 
        success: true, 
        message: `Audio cache cleared for agent ${agentId}`,
        deletedKeys: deletedCount
      });
    } catch (redisError) {
      await redisClient.disconnect();
      throw redisError;
    }
  } catch (error) {
    console.error('Error clearing audio cache:', error);
    res.status(500).json({ 
      error: 'Failed to clear audio cache',
      details: error.message
    });
  }
});

module.exports = router;