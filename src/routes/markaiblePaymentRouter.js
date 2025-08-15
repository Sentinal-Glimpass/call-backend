const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { 
  getClientByClientId, 
  updateClient 
} = require('../apps/interLogue/client');
const { addBillingHistoryInMongo } = require('../apps/exotel/exotel');
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
 *   name: MarkAible Payment
 *   description: Payment processing and balance management with Razorpay integration
 */

// In-memory store for used payment IDs with timestamps (in production, use Redis/Database)
const usedPaymentIds = new Map(); // paymentId -> timestamp

// Clean up old payment IDs (older than 24 hours)
const cleanupOldPaymentIds = () => {
  const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
  for (const [paymentId, timestamp] of usedPaymentIds.entries()) {
    if (timestamp < twentyFourHoursAgo) {
      usedPaymentIds.delete(paymentId);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupOldPaymentIds, 60 * 60 * 1000);

// Validation schemas
const validationSchemas = {
  verifyPayment: createValidationMiddleware({
    body: {
      clientId: {
        required: true,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      },
      rupees: {
        required: true,
        validate: 'isValidPositiveNumber'
      },
      razorpay_payment_id: {
        required: true,
        sanitize: 'sanitizeString',
        minLength: 10,
        maxLength: 100
      },
      razorpay_order_id: {
        required: true,
        sanitize: 'sanitizeString',
        maxLength: 100
      },
      razorpay_signature: {
        required: true,
        sanitize: 'sanitizeString',
        maxLength: 200
      },
      baseAmount: {
        required: false,
        validate: 'isValidPositiveNumber'
      },
      gstAmount: {
        required: false,
        validate: 'isValidPositiveNumber'
      },
      totalAmount: {
        required: false,
        validate: 'isValidPositiveNumber'
      }
    }
  }),

  createOrder: createValidationMiddleware({
    body: {
      clientId: {
        required: true,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      },
      amount: {
        required: true,
        validate: 'isValidPositiveNumber'
      },
      currency: {
        required: false,
        validate: (value) => ['INR', 'USD'].includes(value.toUpperCase()) || 'Currency must be INR or USD',
        sanitize: 'sanitizeString'
      }
    }
  })
};

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Billing configuration
const COST_PER_MINUTE_RUPEES = parseFloat(process.env.COST_PER_MINUTE_RUPEES) || 10;
const SECONDS_PER_MINUTE = 60;

// Helper function to calculate credits from rupees
const calculateCreditsFromRupees = (rupees) => {
  // Credits = seconds, so 1 minute (60 seconds) = COST_PER_MINUTE_RUPEES
  return Math.floor((rupees / COST_PER_MINUTE_RUPEES) * SECONDS_PER_MINUTE);
};


// Verify Razorpay payment signature
const verifyPaymentSignature = (orderId, paymentId, signature, secret) => {
  const body = orderId + "|" + paymentId;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body.toString())
    .digest('hex');
  
  return expectedSignature === signature;
};

// Verify payment with Razorpay API
const verifyPaymentWithRazorpay = async (paymentId) => {
  try {
    const payment = await razorpay.payments.fetch(paymentId);
    return {
      isValid: payment.status === 'captured' || payment.status === 'authorized',
      amount: payment.amount / 100, // Convert paise to rupees
      status: payment.status,
      method: payment.method,
      created_at: payment.created_at
    };
  } catch (error) {
    console.error('Razorpay verification error:', error);
    return {
      isValid: false,
      error: error.message
    };
  }
};

/**
 * @swagger
 * /api/payment/verify-and-add-balance:
 *   post:
 *     tags: [MarkAible Payment]
 *     summary: Verify payment and add balance to client account
 *     description: Verify Razorpay payment, prevent replay attacks, and update client balance
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
 *               - rupees
 *               - razorpay_payment_id
 *               - razorpay_order_id
 *               - razorpay_signature
 *             properties:
 *               clientId:
 *                 type: string
 *                 description: MongoDB ObjectId of the client
 *                 example: "64f8a1b2c3d4e5f6789012ab"
 *               rupees:
 *                 type: number
 *                 description: Amount paid in rupees (excluding GST)
 *                 example: 100
 *               razorpay_payment_id:
 *                 type: string
 *                 description: Razorpay payment ID
 *                 example: "pay_ABC123XYZ789"
 *               razorpay_order_id:
 *                 type: string
 *                 description: Razorpay order ID (required)
 *                 example: "order_ABC123XYZ789"
 *               razorpay_signature:
 *                 type: string
 *                 description: Razorpay signature for verification (required)
 *                 example: "abc123..."
 *               baseAmount:
 *                 type: number
 *                 description: Base amount before GST (optional)
 *                 example: 100
 *               gstAmount:
 *                 type: number
 *                 description: GST amount (optional)
 *                 example: 18
 *               totalAmount:
 *                 type: number
 *                 description: Total amount including GST (optional)
 *                 example: 118
 *               credits:
 *                 type: number
 *                 description: Number of credits (ignored - calculated based on rupees)
 *                 example: 600
 *     responses:
 *       200:
 *         description: Payment verified and balance added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     creditsAdded:
 *                       type: number
 *                     paymentId:
 *                       type: string
 *                     newBalance:
 *                       type: number
 *       400:
 *         description: Bad request - validation error, duplicate payment, or amount mismatch
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/verify-and-add-balance', authenticateToken, validateResourceOwnership, validationSchemas.verifyPayment, auditLog, async (req, res) => {
  try {
    const {
      clientId,
      rupees,  // Amount excluding GST
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      baseAmount,
      gstAmount,
      totalAmount
      // Explicitly ignore newAvailableBalance from frontend
    } = req.body;

    // Calculate credits based on rupees (excluding GST)
    const credits = calculateCreditsFromRupees(rupees);

    // Debug: Log what we received from frontend
    console.log('Received payment verification request:', {
      clientId,
      rupees,
      calculatedCredits: credits,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      baseAmount,
      gstAmount,
      totalAmount
    });

    // STEP 1: Check if payment ID has already been used (Prevent replay attacks)
    if (usedPaymentIds.has(razorpay_payment_id)) {
      return res.status(400).json({
        success: false,
        message: 'Payment ID has already been used',
        error: 'DUPLICATE_PAYMENT_ID'
      });
    }

    // STEP 2: Verify payment with Razorpay API
    console.log('Verifying payment with Razorpay:', razorpay_payment_id);
    const paymentVerification = await verifyPaymentWithRazorpay(razorpay_payment_id);
    
    if (!paymentVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed with Razorpay',
        error: paymentVerification.error,
        paymentStatus: paymentVerification.status
      });
    }

    // STEP 3: Verify payment amount matches request
    // Use totalAmount (with GST) if provided, otherwise use rupees
    const expectedAmount = totalAmount || rupees;
    if (paymentVerification.amount !== expectedAmount) {
      return res.status(400).json({
        success: false,
        message: `Payment amount mismatch. Paid: ₹${paymentVerification.amount}, Expected: ₹${expectedAmount}`
      });
    }

    // STEP 4: Verify payment signature (required)
    const isValidSignature = verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      process.env.RAZORPAY_KEY_SECRET
    );

    if (!isValidSignature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // STEP 5: Credits are already calculated based on rupees (excluding GST)

    console.log('Payment verified successfully:', {
      paymentId: razorpay_payment_id,
      amount: paymentVerification.amount,
      status: paymentVerification.status,
      method: paymentVerification.method
    });

    // STEP 6: Capture payment if it's only authorized
    if (paymentVerification.status === 'authorized') {
      console.log('Capturing authorized payment:', razorpay_payment_id);
      try {
        const captureResponse = await razorpay.payments.capture(
          razorpay_payment_id, 
          paymentVerification.amount * 100, // amount in paise
          'INR'
        );
        console.log('Payment captured successfully:', captureResponse.status);
      } catch (captureError) {
        console.error('Failed to capture payment:', captureError);
        return res.status(500).json({
          success: false,
          message: 'Payment authorized but capture failed',
          error: captureError.message
        });
      }
    }

    // STEP 6: Get current client data to calculate new balance
    console.log('Getting current client data from database...');
    const currentClientData = await getClientByClientId(clientId);
    
    if (!currentClientData || currentClientData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }
    
    // Calculate new balance server-side
    const currentBalance = currentClientData.availableBalance || 0;
    const newAvailableBalance = currentBalance + credits;
    
    console.log('🔢 Balance Calculation Debug:', { 
      clientId, 
      currentBalance, 
      creditsToAdd: credits, 
      calculation: `${currentBalance} + ${credits} = ${newAvailableBalance}`,
      frontendSentBalance: req.body.newAvailableBalance,
      usingServerCalculated: newAvailableBalance
    });

    // Prepare payload for the billing API (matching expected format)
    const billingPayload = {
      clientId: clientId,
      balance: credits,
      transactionType: "Cr",
      desc: `Recharge: Razorpay payment of ${rupees} rupees`,
      newAvailableBalance: newAvailableBalance, // Use server-calculated balance
      date: new Date().toISOString(),
      camp_name: null,
      campaignId: null
    };

    // STEP 7: Update client balance directly in database
    const updatedClientData = {
      ...currentClientData,
      availableBalance: newAvailableBalance,
      lastPaymentDate: new Date().toISOString(),
      lastPaymentAmount: rupees,
      lastPaymentId: razorpay_payment_id,
      lastOrderId: razorpay_order_id,
      lastPaymentSignature: razorpay_signature
    };
    
    console.log('Updating client with new balance:', newAvailableBalance);
    const updateResult = await updateClient(clientId, updatedClientData);
    
    if (updateResult.status !== 200) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update client balance',
        error: updateResult.message
      });
    }
    
    console.log('Client balance updated successfully');

    // STEP 9: Add billing record directly using internal function
    console.log('Adding billing record...');
    
    try {
      // Create extended billing payload with all payment details
      const extendedBillingPayload = {
        camp_name: billingPayload.camp_name,
        clientId: billingPayload.clientId,
        balance: billingPayload.balance,
        date: billingPayload.date,
        campaignId: billingPayload.campaignId,
        desc: `Recharge: Razorpay payment of ${rupees} rupees (excluding GST)`,
        transactionType: billingPayload.transactionType,
        newAvailableBalance: billingPayload.newAvailableBalance,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        paymentSignature: razorpay_signature,
        paymentProvider: 'Razorpay',
        baseAmount: baseAmount || rupees,
        gstAmount: gstAmount || 0,
        totalAmount: totalAmount || rupees
      };
      
      await addBillingHistoryInMongo(
        extendedBillingPayload.camp_name,
        extendedBillingPayload.clientId,
        extendedBillingPayload.balance,
        extendedBillingPayload.date,
        extendedBillingPayload.campaignId,
        extendedBillingPayload.desc,
        extendedBillingPayload.transactionType,
        extendedBillingPayload.newAvailableBalance,
        extendedBillingPayload.paymentId,
        extendedBillingPayload.paymentProvider
      );
      console.log('Billing record added successfully with payment tracking:', {
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        amount: rupees,
        credits: credits
      });
    } catch (billingError) {
      console.error('Billing record failed (non-critical):', billingError);
      // Don't fail the payment if billing fails - the balance is already updated
    }

    // STEP 10: Mark payment ID as used with timestamp (Prevent future reuse)
    usedPaymentIds.set(razorpay_payment_id, Date.now());

    // Log successful transaction (optional)
    console.log('Balance added successfully:', {
      clientId,
      credits,
      paymentId: razorpay_payment_id,
      timestamp: new Date().toISOString()
    });

    // STEP 11: Broadcast balance update via SSE
    try {
      const billingRouter = require('./billingRouter');
      if (billingRouter.broadcastBalanceUpdate && typeof billingRouter.broadcastBalanceUpdate === 'function') {
        billingRouter.broadcastBalanceUpdate(clientId, newAvailableBalance, 'payment_success');
        console.log(`📡 SSE Balance update broadcasted for payment: clientId=${clientId}, newBalance=${newAvailableBalance}`);
      } else {
        console.warn('⚠️ broadcastBalanceUpdate function not available - SSE updates skipped');
      }
    } catch (sseError) {
      console.error('❌ Failed to broadcast balance update via SSE:', sseError.message);
      // Don't fail the payment if SSE broadcast fails
    }

    // Return success response
    res.json({
      success: true,
      message: 'Balance added successfully',
      data: {
        creditsAdded: credits,
        paymentId: razorpay_payment_id,
        newBalance: newAvailableBalance
      }
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    
    // Enhanced error handling with security logging
    const errorInfo = {
      clientId,
      paymentId: razorpay_payment_id,
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack
    };
    
    // Log security-relevant errors
    console.error('Payment processing error details:', errorInfo);
    
    // Handle different types of errors
    if (error.name === 'MongoError' || error.code === 'MONGO_ERROR') {
      // Database error
      res.status(500).json({
        success: false,
        message: 'Database error during payment processing',
        error: 'Payment verification failed'
      });
    } else if (error.message && error.message.includes('Razorpay')) {
      // Razorpay API error
      res.status(400).json({
        success: false,
        message: 'Payment gateway error',
        error: 'Payment verification failed with payment provider'
      });
    } else {
      // Generic error
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'Payment processing failed'
      });
    }
  }
});

/**
 * @swagger
 * /api/payment/create-order:
 *   post:
 *     tags: [MarkAible Payment]
 *     summary: Create Razorpay order for payment
 *     description: Create a Razorpay order to enable auto-capture payments
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
 *               - amount
 *             properties:
 *               clientId:
 *                 type: string
 *                 description: MongoDB ObjectId of the client
 *                 example: "64f8a1b2c3d4e5f6789012ab"
 *               amount:
 *                 type: number
 *                 minimum: 1
 *                 description: Amount in rupees (minimum ₹1)
 *                 example: 100
 *               currency:
 *                 type: string
 *                 enum: [INR, USD]
 *                 default: INR
 *                 description: Payment currency
 *                 example: "INR"
 *     responses:
 *       200:
 *         description: Order created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 order_id:
 *                   type: string
 *                   example: "order_ABC123XYZ789"
 *                 amount:
 *                   type: number
 *                   description: Amount in paise
 *                   example: 10000
 *                 currency:
 *                   type: string
 *                   example: "INR"
 *                 key_id:
 *                   type: string
 *                   example: "rzp_live_ABC123"
 *       400:
 *         description: Bad request - minimum amount is ₹1
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/create-order', authenticateToken, validateResourceOwnership, validationSchemas.createOrder, auditLog, async (req, res) => {
  try {
    const { amount, currency = 'INR' } = req.body;

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: amount * 100, // amount in paise
      currency: currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        purpose: 'credit_recharge',
        credits: calculateCreditsFromRupees(amount),
        rate: `₹${COST_PER_MINUTE_RUPEES}/minute`
      }
    });

    console.log('Razorpay order created:', order);

    res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message
    });
  }
});

module.exports = router;