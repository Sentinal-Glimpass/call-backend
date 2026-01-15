
// const arangojs = require('arangojs'); // REMOVED: Legacy ArangoDB support deprecated
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
require ('dotenv').config();

// Environment validation for production
const requiredEnvVars = [];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0 && process.env.NODE_ENV === 'production') {
  console.error('❌ Missing required environment variables:', missingEnvVars);
  process.exit(1);
}
// LEGACY ROUTERS - DEPRECATED (DO NOT USE)
// const creatorRouter = require('./src/routes/creatorRouter');
// const userRouter = require('./src/routes/userRouter');
// const shopRouter = require('./src/routes/shopRouter');
const interlogueRouter = require('./src/routes/interlogueRouter');
const exotelRouter = require('./src/routes/exotelRouter');
const ipRouter = require('./src/routes/ipRouter');
const plivoRouter = require('./src/routes/plivoRouter');
const plivoApiRouter = require('./src/routes/plivoApiRouter');
const healthRouter = require('./src/routes/healthRouter');

// MarkAible AI Service Routers
const markaibleAiRouter = require('./src/routes/markaibleAiRouter');
const markaibleTrainingRouter = require('./src/routes/markaibleTrainingRouter');
const markaibleGrammarRouter = require('./src/routes/markaibleGrammarRouter');
const markaiblePaymentRouter = require('./src/routes/markaiblePaymentRouter');
const billingRouter = require('./src/routes/billingRouter');
const phoneProviderRouter = require('./src/routes/phoneProviderRouter');
const twilioRouter = require('./src/routes/twilioRouter');
const telephonyCredentialsRouter = require('./src/routes/telephonyCredentialsRouter');
const providerConfigRouter = require('./src/routes/providerConfigRouter');
const toolsRouter = require('./src/routes/toolsRouter');
const watiRouter = require('./src/routes/tools/watiRouter');
const emailRouter = require('./src/routes/tools/emailRouter');
const mcpRouter = require('./src/routes/tools/mcpRouter');
const botIntegrationRouter = require('./src/routes/botIntegrationRouter');
const mcpHttpRouter = require('./src/routes/mcpHttpRouter');
const flowsRouter = require('./src/routes/flowsRouter');
const superadminRouter = require('./src/routes/superadminRouter');
const apiKeyValidator = require('./src/middleware/apiKeyValidator')
const { apiLogger, requestCounter } = require('./src/middleware/apiLogger')
// const { apiLimiter } = require('./src/middleware/authMiddleware')

// ## Const variables for connecting to ArangoDB database
// const dbConfig = {
// 	host: '192.000.00.000',
// 	port: '8529',
// 	username: 'root',
// 	password: '',
// 	database: 'mydb',
// };
// Setup express server
const port = process.env.PORT || 8080; 
const app = express();

// Trust proxy for Cloud Run
app.set('trust proxy', 1);

// Security headers for production
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove sensitive headers
  res.removeHeader('X-Powered-By');
  
  next();
});

// Configure CORS for production security
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    // Define patterns for allowed origins
    const allowedPatterns = [
      /^https?:\/\/localhost(:\d+)?$/, // Any localhost with any port
      /^https?:\/\/.*\.markaible\.com$/, // Any subdomain of markaible.com
      /^https?:\/\/.*\.glimpass\.com$/, // Any subdomain of glimpass.com
      /^https?:\/\/markaible\.com$/, // Root markaible.com domain
      /^https?:\/\/glimpass\.com$/ // Root glimpass.com domain
    ];
    
    // Check custom allowed origins from environment
    const customOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
      : [];
    
    // Check if origin matches any pattern or custom origin
    const isAllowed = allowedPatterns.some(pattern => pattern.test(origin)) || 
                      customOrigins.includes(origin);
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log(`🚫 CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Accept']
};

app.use(cors(corsOptions));

// Debug middleware for MCP endpoints (non-consuming)
app.use('/mcp', (req, res, next) => {
  console.log(`🔬 [DEBUG] ${req.method} ${req.path}`);
  console.log(`🔬 [DEBUG] Content-Length: ${req.headers['content-length']}`);
  console.log(`🔬 [DEBUG] Content-Type: ${req.headers['content-type']}`);

  // Check for duplicate content-type headers
  const contentType = req.headers['content-type'];
  if (contentType && contentType.includes(',')) {
    console.log(`⚠️ [DEBUG] DUPLICATE Content-Type detected: ${contentType}`);
    // Fix the duplicate content-type header
    req.headers['content-type'] = 'application/json';
    console.log(`✅ [DEBUG] Fixed Content-Type to: ${req.headers['content-type']}`);
  }

  next();
});

app.use(express.urlencoded({ limit: '50mb', extended: true }));  // For URL-encoded data
app.use(express.json({
  limit: '10mb',
  strict: false // Allow non-strict JSON parsing for better compatibility
})); // Limit JSON payloads

// Add request timeout middleware (30 seconds)
app.use((req, res, next) => {
  // Set timeout for all requests except file uploads
  const timeout = req.path.includes('upload') ? 60000 : 30000; // 60s for uploads, 30s for others
  
  req.setTimeout(timeout, () => {
    console.log(`⏰ Request timeout: ${req.method} ${req.path} from ${req.ip}`);
    if (!res.headersSent) {
      res.status(408).json({ 
        error: 'Request Timeout',
        message: 'Request took too long to process'
      });
    }
  });
  
  res.setTimeout(timeout, () => {
    console.log(`⏰ Response timeout: ${req.method} ${req.path} from ${req.ip}`);
    if (!res.headersSent) {
      res.status(408).json({ 
        error: 'Response Timeout',
        message: 'Response took too long to generate'
      });
    }
  });
  
  next();
});

// Add comprehensive API logging middleware
app.use(apiLogger);
app.use(requestCounter);

app.use((req, res, next) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    const clientIp = forwardedFor
        ? forwardedFor.split(',')[0] // First IP in case of multiple proxies
        : req.connection.remoteAddress;

    console.log(`Client IP: ${clientIp}`);
    next();
});

// Apply rate limiting to all API routes - REMOVED
// app.use(apiLimiter);

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     ApiKeyAuth:
 *       type: apiKey
 *       in: header
 *       name: X-API-Key
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Glimpass Backend API',
      version: '1.0.0',
      description: 'API for graph-based navigation and multi-platform communication integrations',
      contact: {
        name: 'Glimpass Team'
      }
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? `https://${process.env.CLOUD_RUN_SERVICE_URL || 'your-service.run.app'}`
          : `http://localhost:${process.env.PORT || 8080}`,
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
      }
    ],
  },
  apis: ['./index.js', './src/routes/*.js'],
};

const specs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Health check routes (no authentication required)
app.use('/health', healthRouter);

// Cloud Run health check
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Bot warmup endpoint (no authentication required)
app.get('/warmup', (req, res) => {
  res.status(200).json({ 
    status: 'ready', 
    timestamp: new Date().toISOString(),
    warmup: true,
    message: 'Bot warmup successful'
  });
});

// Public routes (no authentication required)
app.use('/interlogue', interlogueRouter); // Contains both public /get-client and protected routes

// Active routes
app.use('/plivo', plivoRouter);
app.use('/exotel', exotelRouter);
app.use('/ip', ipRouter);
app.use('/health', healthRouter);
app.use('/api', plivoApiRouter)

// MarkAible AI Service Routes (using exact original endpoints)
app.use('/api/create-ai', markaibleAiRouter);
app.use('/api/train-ai', markaibleTrainingRouter);
app.use('/api/grammar', markaibleGrammarRouter);
app.use('/api/payment', markaiblePaymentRouter);
app.use('/billing', billingRouter);
app.use('/phone-provider', phoneProviderRouter);
app.use('/twilio', twilioRouter);
app.use('/telephony-credentials', telephonyCredentialsRouter);
app.use('/provider-config', providerConfigRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/tools/wati', watiRouter); // New WATI tool endpoints
app.use('/api/tools/gmail', emailRouter); // New Gmail tool endpoints
app.use('/api/tools/mcp', mcpRouter); // New MCP tool endpoints
app.use('/api/bot-integration', botIntegrationRouter); // Unified bot integration API
app.use('/mcp', mcpHttpRouter); // HTTP MCP server endpoints for cross-server communication
app.use('/wati', toolsRouter); // Legacy direct mount for WATI endpoints
app.use('/api/flows', flowsRouter); // Flow-based agent conversation management
app.use('/superadmin', superadminRouter); // Superadmin operations (Super Key auth)

// LEGACY ROUTES - DEPRECATED (DO NOT USE)
// app.use('/graph', creatorRouter);
// app.use('/user', userRouter); 
// app.use('/shop', shopRouter); 

// Connection to ArangoDB
// const db = new arangojs.Database({
// 	url: `http://${dbConfig.host}:${dbConfig.port}`,
// 	databaseName: dbConfig.database
// });

// db.useBasicAuth(dbConfig.username, dbConfig.password);

// Graceful shutdown handling for Cloud Run
const shutdown = (signal) => {
  console.log(`🛑 Received ${signal}, starting graceful shutdown...`);
  server.close((err) => {
    if (err) {
      console.error('❌ Error during server shutdown:', err);
      process.exit(1);
    }
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// START THE SERVER
const server = app.listen(port, async function(){
	console.log(`🚀 Server started on port ${port} in ${process.env.NODE_ENV || 'development'} mode`);
	console.log(`📊 Swagger UI available at: http://localhost:${port}/api-docs`);
	
	// Initialize Cloud Run container lifecycle management
	try {
		const { initializeContainer } = require('./src/utils/containerLifecycle.js');
		await initializeContainer();
		console.log('✅ Container lifecycle initialized');
	} catch (error) {
		console.error('❌ Error initializing container lifecycle:', error);
		// Continue server startup even if container lifecycle fails
	}
}); 


// app.get('/api/tasks', function(req, res){
// 	taskCollection
// 		.all()
// 		.then(function(response) {
// 			console.log(`Retrieved documents.`, response._result);

// 			return res.status(200).json(response._result);
// 		})
// 		.catch(function(error) {
// 			console.error('Error getting document', error);
// 			return res.status(500).json(error);
// 		});
// });


// app.get('/api/tasks/:id', function(req, res){
// 	taskCollection
// 		.firstExample({_key: req.params.id})
// 		.then(function(doc) {
// 			console.log(`Retrieved documents by _key "${req.params.id}".`, doc);

// 			return res.status(200).json(doc);
// 		})
// 		.catch(function(error) {
// 			console.error('Error getting document', error);
// 			return res.status(500).json(error);
// 		});
// });
