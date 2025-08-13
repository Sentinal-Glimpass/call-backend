const express = require('express');
const router = express.Router();
const { 
  getCallDetails,
  needsIncomingAggregation,
  aggregateIncomingCallsSince,
  saveAggregationToBillingHistory
} = require('../apps/billing/billingCore');
const { 
  getClientByClientId
} = require('../apps/interLogue/client');
const { 
  getBillingHistoryByClientId
} = require('../apps/exotel/exotel');
const { 
  authenticateToken, 
  validateResourceOwnership 
} = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Billing System
 *   description: Enhanced billing system with real-time balance, call details, and aggregated views
 */

// SSE connections store
const balanceConnections = new Map(); // clientId -> Set of response objects

/**
 * @swagger
 * /billing/stream/balance/{clientId}:
 *   get:
 *     tags: [Billing System]
 *     summary: Real-time balance stream via Server-Sent Events
 *     description: Establishes SSE connection for real-time balance updates. Authentication via token query parameter since SSE cannot send headers.
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ID
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: JWT token for authentication (since SSE cannot send headers)
 *     responses:
 *       200:
 *         description: SSE stream established
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: "data: {\"balance\": 1500, \"timestamp\": \"2024-01-15T10:30:00Z\"}\n\n"
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Client not found
 */
router.get('/stream/balance/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const { token } = req.query;
  
  try {
    // Manual authentication since SSE cannot send headers
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token required as query parameter: ?token=YOUR_JWT_TOKEN'
      });
    }
    
    // Verify JWT token manually
    const jwt = require('jsonwebtoken');
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    
    // Verify client exists and user has access
    const clientData = await getClientByClientId(clientId);
    if (!clientData || clientData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }
    
    // Verify client ownership (user can only access their own client data)
    if (decodedToken.email !== clientData.email) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only access your own client data'
      });
    }
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // Send initial balance
    const initialBalance = {
      balance: clientData.availableBalance || 0,
      timestamp: new Date().toISOString(),
      type: 'initial'
    };
    
    res.write(`data: ${JSON.stringify(initialBalance)}\n\n`);
    
    // Store connection for this client
    if (!balanceConnections.has(clientId)) {
      balanceConnections.set(clientId, new Set());
    }
    balanceConnections.get(clientId).add(res);
    
    console.log(`🔴 SSE connection established for client ${clientId} (${balanceConnections.get(clientId).size} total connections)`);
    
    // Handle client disconnect
    req.on('close', () => {
      if (balanceConnections.has(clientId)) {
        balanceConnections.get(clientId).delete(res);
        if (balanceConnections.get(clientId).size === 0) {
          balanceConnections.delete(clientId);
        }
      }
      console.log(`🔴 SSE connection closed for client ${clientId}`);
    });
    
    // Send periodic heartbeat
    const heartbeatInterval = setInterval(() => {
      if (res.finished) {
        clearInterval(heartbeatInterval);
        return;
      }
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
    }, 30000); // Every 30 seconds
    
    req.on('close', () => {
      clearInterval(heartbeatInterval);
    });
    
  } catch (error) {
    console.error('❌ Error setting up balance stream:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to establish balance stream',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /billing/call-details/{clientId}:
 *   get:
 *     tags: [Billing System]
 *     summary: Get paginated call-level billing details
 *     description: Returns detailed billing information for individual calls with cursor-based pagination
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ID
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Cursor for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 100
 *         description: Number of records to return
 *     responses:
 *       200:
 *         description: Call details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 calls:
 *                   type: array
 *                   items:
 *                     type: object
 *                 nextCursor:
 *                   type: string
 *                 hasMore:
 *                   type: boolean
 *                 totalReturned:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/call-details/:clientId', authenticateToken, validateResourceOwnership, async (req, res) => {
  const { clientId } = req.params;
  const { cursor, limit = 100 } = req.query;
  
  try {
    const parsedLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 1000);
    
    const result = await getCallDetails(clientId, cursor, parsedLimit);
    
    if (result.success) {
      res.json({
        success: true,
        calls: result.calls,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        totalReturned: result.totalReturned
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve call details',
        error: result.error
      });
    }
    
  } catch (error) {
    console.error('❌ Error getting call details:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /billing/aggregated/{clientId}:
 *   get:
 *     tags: [Billing System]
 *     summary: Get aggregated billing view with smart aggregation
 *     description: Returns aggregated billing data with automatic incoming call aggregation when conditions are met
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ID
 *     responses:
 *       200:
 *         description: Aggregated billing data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 billingHistory:
 *                   type: array
 *                 aggregationPerformed:
 *                   type: boolean
 *                 aggregationDetails:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/aggregated/:clientId', authenticateToken, validateResourceOwnership, async (req, res) => {
  const { clientId } = req.params;
  
  try {
    let aggregationPerformed = false;
    let aggregationDetails = null;
    
    // Check if incoming call aggregation is needed
    const aggregationCheck = await needsIncomingAggregation(clientId);
    
    if (aggregationCheck.needed) {
      console.log(`🔄 Performing incoming call aggregation for client ${clientId}`);
      
      // Aggregate incoming calls since last aggregation
      const aggregationResult = await aggregateIncomingCallsSince(
        clientId, 
        aggregationCheck.lastAggregationTime
      );
      
      if (aggregationResult.success && aggregationResult.totalCalls > 0) {
        // Save aggregation to billing history
        const title = `Incoming Calls (${aggregationResult.startTime.toLocaleDateString()} - ${aggregationResult.endTime.toLocaleDateString()})`;
        
        const saveResult = await saveAggregationToBillingHistory({
          clientId,
          type: 'incoming',
          title,
          totalCalls: aggregationResult.totalCalls,
          totalCredits: aggregationResult.totalCredits,
          totalDuration: aggregationResult.totalDuration,
          startTime: aggregationResult.startTime,
          endTime: aggregationResult.endTime
        });
        
        if (saveResult.success) {
          aggregationPerformed = true;
          aggregationDetails = {
            totalCalls: aggregationResult.totalCalls,
            totalCredits: aggregationResult.totalCredits,
            totalDuration: aggregationResult.totalDuration,
            period: {
              start: aggregationResult.startTime,
              end: aggregationResult.endTime
            }
          };
          
          console.log(`✅ Incoming call aggregation completed: ${aggregationResult.totalCalls} calls, ${aggregationResult.totalCredits} credits`);
        }
      }
    }
    
    // Get updated billing history (returns array directly)
    console.log(`🔍 Debug: Fetching billing history for clientId: ${clientId}`);
    const billingHistory = await getBillingHistoryByClientId(clientId);
    console.log(`🔍 Debug: Retrieved billing history:`, {
      type: typeof billingHistory,
      isArray: Array.isArray(billingHistory), 
      length: Array.isArray(billingHistory) ? billingHistory.length : 'N/A',
      firstItem: Array.isArray(billingHistory) && billingHistory.length > 0 ? billingHistory[0] : 'N/A'
    });
    
    res.json({
      success: true,
      billingHistory: Array.isArray(billingHistory) ? billingHistory : [],
      aggregationPerformed,
      aggregationDetails,
      lastAggregationCheck: aggregationCheck.lastAggregationTime,
      nextAggregationAvailable: aggregationCheck.lastAggregationTime 
        ? new Date(aggregationCheck.lastAggregationTime.getTime() + aggregationCheck.thresholdTime)
        : null
    });
    
  } catch (error) {
    console.error('❌ Error getting aggregated billing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve aggregated billing data',
      error: error.message
    });
  }
});

/**
 * Utility function to broadcast balance updates to connected SSE clients
 * @param {string} clientId - Client ID
 * @param {number} newBalance - Updated balance
 * @param {string} changeType - Type of change (call_end, payment, etc.)
 */
function broadcastBalanceUpdate(clientId, newBalance, changeType = 'balance_update') {
  if (balanceConnections.has(clientId)) {
    const connections = balanceConnections.get(clientId);
    const updateData = {
      balance: newBalance,
      timestamp: new Date().toISOString(),
      type: changeType
    };
    
    const message = `data: ${JSON.stringify(updateData)}\n\n`;
    
    // Send to all active connections for this client
    connections.forEach(res => {
      if (!res.finished) {
        try {
          res.write(message);
        } catch (error) {
          console.warn('Failed to send balance update to SSE client:', error.message);
          connections.delete(res);
        }
      } else {
        connections.delete(res);
      }
    });
    
    console.log(`📡 Balance update broadcasted to ${connections.size} SSE connections for client ${clientId}: ${newBalance} credits`);
    
    // Clean up empty connection sets
    if (connections.size === 0) {
      balanceConnections.delete(clientId);
    }
  }
}

/**
 * @swagger
 * /billing/update-ai-credits:
 *   post:
 *     tags: [Billing System]
 *     summary: Update AI credits for a call record
 *     description: Updates AI credits for an existing call record (used by bot endpoint)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - callUuid
 *               - aiCredits
 *             properties:
 *               callUuid:
 *                 type: string
 *                 description: Call UUID to update
 *               aiCredits:
 *                 type: number
 *                 minimum: 0
 *                 description: AI credits to add
 *     responses:
 *       200:
 *         description: AI credits updated successfully
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: Call record not found
 *       500:
 *         description: Internal server error
 */
router.post('/update-ai-credits', authenticateToken, async (req, res) => {
  const { callUuid, aiCredits } = req.body;
  
  try {
    // Validate input
    if (!callUuid || typeof aiCredits !== 'number' || aiCredits < 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data. callUuid and positive aiCredits required.'
      });
    }
    
    const { updateCallAICredits } = require('../apps/billing/billingCore');
    const result = await updateCallAICredits(callUuid, aiCredits);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'AI credits updated successfully',
        callUuid,
        aiCredits
      });
    } else {
      const statusCode = result.error === 'Call record not found' ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: result.error || 'Failed to update AI credits'
      });
    }
    
  } catch (error) {
    console.error('❌ Error updating AI credits:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Export the broadcast function for use in other modules
router.broadcastBalanceUpdate = broadcastBalanceUpdate;

module.exports = router;