const express = require('express');
const router = express.Router();
const { groqClient } = require('../utils/groqClient');
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
 *   name: MarkAible Grammar
 *   description: Grammar correction and text enhancement services
 */

// Validation schemas
const validationSchemas = {
  grammarCorrection: createValidationMiddleware({
    body: {
      text: {
        required: false,
        sanitize: 'sanitizeString',
        maxLength: 5000
      },
      hotCond: {
        required: false,
        validate: (value) => Array.isArray(value) || 'hotCond must be an array'
      },
      warmCond: {
        required: false,
        validate: (value) => Array.isArray(value) || 'warmCond must be an array'
      }
    }
  }),
  
  conditionsCorrection: createValidationMiddleware({
    body: {
      hotCond: {
        required: false,
        validate: (value) => Array.isArray(value) || 'hotCond must be an array'
      },
      warmCond: {
        required: false,
        validate: (value) => Array.isArray(value) || 'warmCond must be an array'
      }
    }
  }),
  
  rephraseText: createValidationMiddleware({
    body: {
      text: {
        required: true,
        sanitize: 'sanitizeString',
        minLength: 1,
        maxLength: 5000
      },
      tone: {
        required: false,
        validate: (value) => ['professional', 'casual', 'friendly', 'formal', 'persuasive'].includes(value.toLowerCase()) || 'Invalid tone',
        sanitize: 'sanitizeString'
      }
    }
  })
};

/**
 * @swagger
 * /api/grammar/correct:
 *   post:
 *     tags: [MarkAible Grammar]
 *     summary: Grammar correction and text improvement
 *     description: Correct grammatical errors and improve text clarity while maintaining original meaning
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *                 description: Text to correct
 *                 example: "Hello, I am needs help with grammar checking."
 *               hotCond:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Hot conditions array (alternative to text)
 *                 example: ["Interested in buying", "Ready to purchase"]
 *               warmCond:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Warm conditions array (alternative to text)
 *                 example: ["Might be interested", "Considering options"]
 *     responses:
 *       200:
 *         description: Text corrected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 response:
 *                   type: object
 *                   properties:
 *                     corrected_text:
 *                       type: string
 *                     changes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           original:
 *                             type: string
 *                           corrected:
 *                             type: string
 *                           explanation:
 *                             type: string
 *                     hotCond:
 *                       type: array
 *                       items:
 *                         type: string
 *                     warmCond:
 *                       type: array
 *                       items:
 *                         type: string
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/correct', authenticateToken, validateResourceOwnership, validationSchemas.grammarCorrection, auditLog, async (req, res) => {
  try {
    const { text, hotCond, warmCond } = req.body;
    
    // Handle both text string and condition arrays
    if (!text && !hotCond && !warmCond) {
      return res.status(400).json({ error: 'Missing text or conditions to correct' });
    }

    console.log('Processing grammar correction request');
    
    let content = '';
    if (text) {
      content = text;
    } else {
      // Format conditions for correction
      const hotConditions = hotCond ? hotCond.join(', ') : '';
      const warmConditions = warmCond ? warmCond.join(', ') : '';
      content = `Hot conditions: ${hotConditions}\nWarm conditions: ${warmConditions}`;
    }
    
    const completion = await groqClient.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are a professional grammar and language expert. Your task is to:
1. Correct any grammatical errors in the provided text
2. Improve phrasing and clarity while maintaining the original meaning
3. If the input contains "conditions" (like "Hot conditions" or "Warm conditions"), maintain the same structure in your response
4. Return your response in JSON format with these fields:
   {
     "corrected_text": "The grammatically correct and improved text",
     "changes": [
       {
         "original": "Text with error",
         "corrected": "Corrected text",
         "explanation": "Brief explanation of the correction"
       }
     ]
   }`
        },
        {
          role: 'user',
          content: content
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 4096,
    });

    let response = completion.choices[0]?.message?.content;
    console.log('Raw AI response:', response);

    if (!response) {
      throw new Error('No response received from AI');
    }

    try {
      // Clean response by removing markdown code blocks if present
      if (response.startsWith('```') && response.includes('```')) {
        response = response.replace(/```json\n/, '').replace(/```\n?$/, '');
      }
      
      response = JSON.parse(response);
      console.log('Parsed response:', response);
      
      // If the input was conditions, convert the response back to the original format
      if (hotCond || warmCond) {
        const correctedText = response.corrected_text;
        
        // Extract corrected conditions
        const hotMatch = correctedText.match(/Hot conditions: (.*?)(?:\n|$)/);
        const warmMatch = correctedText.match(/Warm conditions: (.*?)(?:\n|$)/);
        
        const correctedHotCond = hotMatch ? hotMatch[1].split(', ').map(item => item.trim()) : hotCond;
        const correctedWarmCond = warmMatch ? warmMatch[1].split(', ').map(item => item.trim()) : warmCond;
        
        response.hotCond = correctedHotCond;
        response.warmCond = correctedWarmCond;
      }
      
    } catch (e) {
      console.error('JSON parse error:', e);
      console.log('Attempting to clean response...');
      
      // Clean the response string and create a simplified response
      try {
        if (hotCond || warmCond) {
          // For condition format
          response = {
            corrected_text: response,
            hotCond: hotCond,
            warmCond: warmCond,
            changes: []
          };
        } else {
          // For text format
          response = {
            corrected_text: response,
            changes: []
          };
        }
      } catch (e2) {
        console.error('Failed to create simplified response:', e2);
        throw new Error('Invalid response format');
      }
    }

    res.json({ response });
  } catch (error) {
    console.error('Error in grammar correction:', error);
    res.status(500).json({ 
      error: 'Failed to process grammar correction request',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/grammar/correct-conditions:
 *   post:
 *     tags: [MarkAible Grammar]
 *     summary: Bulk grammar correction for campaign conditions
 *     description: Correct grammar for multiple campaign conditions simultaneously
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hotCond:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Hot conditions to correct
 *                 example: ["Ready for buy", "Want to purchase now"]
 *               warmCond:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Warm conditions to correct
 *                 example: ["Maybe interested", "Could be good fit"]
 *     responses:
 *       200:
 *         description: Conditions corrected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 response:
 *                   type: object
 *                   properties:
 *                     hotCond:
 *                       type: array
 *                       items:
 *                         type: string
 *                     warmCond:
 *                       type: array
 *                       items:
 *                         type: string
 *                     changes:
 *                       type: array
 *                       items:
 *                         type: object
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/correct-conditions', authenticateToken, validateResourceOwnership, validationSchemas.conditionsCorrection, auditLog, async (req, res) => {
  try {
    const { hotCond, warmCond } = req.body;
    
    if (!hotCond && !warmCond) {
      return res.status(400).json({ error: 'Missing conditions to correct' });
    }

    console.log('Processing campaign conditions correction');
    
    const completion = await groqClient.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are a professional grammar and language expert. Your task is to:
1. Correct any grammatical errors in the provided campaign conditions
2. Improve phrasing and clarity while maintaining the original meaning
3. Keep phrases concise and effective for marketing campaigns
4. Return your response in JSON format with these fields:
   {
     "hotCond": ["corrected condition 1", "corrected condition 2", ...],
     "warmCond": ["corrected condition 1", "corrected condition 2", ...],
     "changes": [
       {
         "original": "Original condition",
         "corrected": "Corrected condition",
         "explanation": "Brief explanation of the correction"
       }
     ]
   }`
        },
        {
          role: 'user',
          content: JSON.stringify({ hotCond, warmCond }, null, 2)
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 4096,
    });

    let response = completion.choices[0]?.message?.content;
    console.log('Raw AI response:', response);

    if (!response) {
      throw new Error('No response received from AI');
    }

    try {
      // Clean response by removing markdown code blocks if present
      if (response.startsWith('```') && response.includes('```')) {
        response = response.replace(/```json\n/, '').replace(/```\n?$/, '');
      }
      
      response = JSON.parse(response);
      console.log('Parsed response:', response);
    } catch (e) {
      console.error('JSON parse error:', e);
      console.log('Attempting to clean response...');
      
      // Return original conditions if parsing fails
      try {
        response = {
          hotCond: hotCond,
          warmCond: warmCond,
          changes: [],
          error: "Failed to parse AI response"
        };
      } catch (e2) {
        console.error('Failed to create simplified response:', e2);
        throw new Error('Invalid response format');
      }
    }

    res.json({ response });
  } catch (error) {
    console.error('Error in conditions correction:', error);
    res.status(500).json({ 
      error: 'Failed to process conditions correction request',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/grammar/rephrase:
 *   post:
 *     tags: [MarkAible Grammar]
 *     summary: Rephrase text with different tones
 *     description: Rephrase text to match a specific tone while maintaining original meaning
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 description: Text to rephrase
 *                 example: "We need to discuss your requirements immediately."
 *               tone:
 *                 type: string
 *                 enum: [professional, casual, friendly, formal, persuasive]
 *                 description: Target tone for rephrasing
 *                 example: "friendly"
 *                 default: "professional"
 *     responses:
 *       200:
 *         description: Text rephrased successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 response:
 *                   type: object
 *                   properties:
 *                     rephrased_text:
 *                       type: string
 *                       example: "I'd love to chat about what you're looking for!"
 *                     explanation:
 *                       type: string
 *                       example: "Changed formal language to friendly tone"
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/rephrase', authenticateToken, validateResourceOwnership, validationSchemas.rephraseText, auditLog, async (req, res) => {
  try {
    const { text, tone } = req.body;

    const targetTone = tone || 'professional';
    console.log('Processing rephrasing request with tone:', targetTone);
    
    const completion = await groqClient.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are a professional writing assistant. Your task is to:
1. Rephrase the provided text to match a ${targetTone} tone
2. Maintain the original meaning while improving clarity and flow
3. Return your response in JSON format with these fields:
   {
     "rephrased_text": "The rephrased text with ${targetTone} tone",
     "explanation": "Brief explanation of the changes made to achieve the ${targetTone} tone"
   }`
        },
        {
          role: 'user',
          content: text
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
      max_tokens: 4096,
    });

    let response = completion.choices[0]?.message?.content;
    console.log('Raw AI response:', response);

    if (!response) {
      throw new Error('No response received from AI');
    }

    try {
      // Clean response by removing markdown code blocks if present
      if (response.startsWith('```') && response.includes('```')) {
        response = response.replace(/```json\n/, '').replace(/```\n?$/, '');
      }
      
      response = JSON.parse(response);
      console.log('Parsed response:', response);
    } catch (e) {
      console.error('JSON parse error:', e);
      console.log('Attempting to clean response...');
      
      // Clean the response string and create a simplified response
      try {
        response = {
          rephrased_text: response,
          explanation: "Response format error, returning raw rephrasing"
        };
      } catch (e2) {
        console.error('Failed to create simplified response:', e2);
        throw new Error('Invalid response format');
      }
    }

    res.json({ response });
  } catch (error) {
    console.error('Error in rephrasing:', error);
    res.status(500).json({ 
      error: 'Failed to process rephrasing request',
      details: error.message
    });
  }
});

module.exports = router;