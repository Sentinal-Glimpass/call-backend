# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start development server**: `npm start` - Uses nodemon with babel-node to run index.js with auto-restart
- **No build command**: This project runs directly via babel-node transpilation
- **No test framework configured**: Tests need to be set up if required
- **No linting configured**: Linting tools need to be set up if required

## Architecture Overview

This is a Node.js backend service called "glimpass" that provides APIs for graph-based navigation and multi-platform communication integrations.

### Core Technology Stack
- **Runtime**: Node.js with Express.js
- **Transpilation**: Babel (ES6+ support via @babel/preset-env)
- **Databases**: 
  - MongoDB (primary database for all application data)
  - ~~ArangoDB (LEGACY - no longer used, graph features deprecated)~~
- **Third-party Integrations**: Plivo, Exotel, Twilio, Google Cloud Storage, Azure OpenAI, Groq AI, Razorpay, Redis

### Application Structure

#### Entry Point (`index.js`)
- Express server setup with CORS and body parsing
- API route mounting with middleware
- Client IP logging middleware
- MongoDB connection for all data operations

#### Database Layer
- `models/mongodb.js`: MongoDB Atlas connection for all application data
- ~~`models/db.js`: ArangoDB connection (LEGACY - deprecated)~~
- Database credentials are now securely stored in environment variables

#### API Routes Structure (`src/routes/`)

**ACTIVE ROUTERS (Current Development Focus):**
- `interlogueRouter.js`: Interlogue service integration
- `exotelRouter.js`: Exotel telephony integration
- `plivoRouter.js`: Plivo SMS/voice integration
- `plivoApiRouter.js`: Protected Plivo API (requires API key)
- `ipRouter.js`: IP-related operations
- `markaibleAiRouter.js`: AI prompt generation and management
- `markaibleTrainingRouter.js`: AI prompt training and refinement interface
- `markaibleGrammarRouter.js`: Grammar correction and text enhancement services
- `markaiblePaymentRouter.js`: Payment processing with Razorpay integration

**LEGACY ROUTERS (DO NOT MODIFY - Old Code):**
- `creatorRouter.js`: Graph creation, node management, shortest path calculations (LEGACY)
- `userRouter.js`: User management and entity finding operations (LEGACY)
- `shopRouter.js`: Shopping-related functionality (LEGACY)

#### Business Logic (`src/apps/`)

**ACTIVE MODULES (Current Development Focus):**
- `interLogue/`: Fitness and client management
- `exotel/`: Call handling and telephony operations
- `plivo/`: SMS and voice operations
- `helper/`: Utility functions for crypto and active calls
- `markaible/`: AI prompt generation, training, grammar services, and payment processing

**LEGACY MODULES (DO NOT MODIFY - Old Code):**
- `creator/`: Graph database operations, node/edge management, pathfinding algorithms (LEGACY)
- `user/`: User registration, nearest entity finding (LEGACY)
- `shop/`: Shopping functionality (LEGACY)

#### Middleware
- `apiKeyValidator.js`: MongoDB-based API key authentication for protected routes

### Key Features

1. **Multi-platform Communication**: Integrates with Plivo, Exotel, and Twilio for SMS/voice
2. **File Upload**: Google Cloud Storage integration for image uploads
3. **JWT Authentication**: Secure token-based authentication system
4. **Campaign Management**: Real-time campaign tracking and reporting
5. **Contact Management**: CSV-based contact list management
6. **AI Prompt Generation**: Groq-powered structured prompt creation for voice agents
7. **Grammar Services**: Text correction and enhancement capabilities
8. **Payment Processing**: Razorpay integration for credit recharge and balance management

### Database Schemas

#### MongoDB Collections  
- `client`: API key management and client authentication
- `plivoCampaign`: Campaign data and status tracking
- `plivo-list`: Contact list management
- `plivo-list-data`: Individual contact records
- `plivoHangupData`: Call completion data
- `logData`: Conversation logs and analytics
- `leadData`: Lead generation and tracking

### Environment Dependencies
- MongoDB Atlas connection (primary database)
- Google Cloud Storage bucket configuration
- Plivo, Exotel, Twilio API credentials
- Azure OpenAI API access
- JWT secret configuration
- Groq API key for AI prompt generation
- Razorpay credentials for payment processing
- Redis connection for audio cache management

### Development Guidelines

**IMPORTANT: Focus Areas**
- **ONLY work with ACTIVE routers/modules** listed above
- **DO NOT modify LEGACY code** (creatorRouter, userRouter, shopRouter and their corresponding apps)
- When adding new features or fixing issues, focus on:
  - `interlogueRouter.js` and `src/apps/interLogue/`
  - `exotelRouter.js` and `src/apps/exotel/`
  - `plivoRouter.js`, `plivoApiRouter.js` and `src/apps/plivo/`
  - `ipRouter.js`
  - `src/apps/helper/`
  - `markaibleAiRouter.js`, `markaibleTrainingRouter.js`, `markaibleGrammarRouter.js`, `markaiblePaymentRouter.js` and `src/apps/markaible/`

### Development Notes
- Database connection strings and credentials are hardcoded and should be moved to environment variables
- No testing framework currently configured
- Uses ES6+ features transpiled through Babel
- File uploads stored in local `uploads/` directory and Google Cloud Storage
- Multiple commented-out database configurations suggest different deployment environments
- **API Documentation**: Swagger UI available at `http://localhost:7999/api-docs`
- **Auto-reload**: Nodemon provides automatic server restart on file changes