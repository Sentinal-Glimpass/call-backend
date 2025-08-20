/**
 * Bot Warmup Utility
 * Ensures bot is ready before making Plivo calls
 */

const axios = require('axios');
const { v4: uuid4 } = require('uuid');

/**
 * Extract base URL from WebSocket URL
 * @param {string} wssUrl - WebSocket URL (e.g., ws://server:port/chat/v2/agent_id)
 * @returns {string} - Base URL (e.g., http://server:port)
 */
function extractBaseUrlFromWss(wssUrl) {
  try {
    const url = new URL(wssUrl);
    // Convert ws:// to http:// and wss:// to https://
    const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    return `${protocol}//${url.host}`;
  } catch (error) {
    console.warn(`⚠️ Failed to extract base URL from WSS URL: ${wssUrl}`);
    return null;
  }
}

/**
 * Warmup bot with retry logic using session-based approach
 * @param {string} wssUrl - WebSocket URL to extract base URL from
 * @param {string} agentId - Agent ID for the session
 * @returns {Promise<{success: boolean, attempts: number, duration: number, sessionUuid?: string, error?: string}>}
 */
async function warmupBotWithRetry(wssUrl, agentId) {
  const maxRetries = parseInt(process.env.BOT_WARMUP_RETRIES) || 3;
  const timeout = parseInt(process.env.BOT_WARMUP_TIMEOUT) || 120000; // 120 seconds
  const warmupPath = process.env.BOT_WARMUP_URL || '/warmup';
  
  if (!wssUrl) {
    console.warn('⚠️  WebSocket URL not provided, skipping bot warmup');
    return { success: true, attempts: 0, duration: 0 };
  }
  
  if (!agentId) {
    console.warn('⚠️  Agent ID not provided, skipping bot warmup');
    return { success: false, attempts: 0, duration: 0, error: 'Agent ID is required' };
  }
  
  // Extract base URL from WebSocket URL
  const baseUrl = extractBaseUrlFromWss(wssUrl);
  if (!baseUrl) {
    return { success: false, attempts: 0, duration: 0, error: 'Could not extract base URL from WebSocket URL' };
  }
  
  // Generate UUID for this session
  const sessionUuid = uuid4();
  const warmupUrl = `${baseUrl}${warmupPath}/${sessionUuid}`;
  
  console.log(`🆔 Generated session UUID: ${sessionUuid}`);
  console.log(`🌐 Extracted base URL: ${baseUrl} from WSS: ${wssUrl}`);
  console.log(`🔗 Warmup path: ${warmupPath}`);
  console.log(`🎯 Final warmup URL: ${warmupUrl}`);
  console.log(`🤖 Agent ID: ${agentId}`);
  
  let attempts = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < maxRetries; i++) {
    attempts++;
    
    try {
      console.log(`🤖 Bot warmup attempt ${attempts}/${maxRetries}...`);
      console.log(`📡 POST ${warmupUrl}`);
      console.log(`📦 Payload: {"agent_id": "${agentId}"}`);
      
      const response = await axios.post(warmupUrl, 
        { agent_id: agentId },
        {
          timeout: timeout,
          headers: {
            'User-Agent': 'GlimpassCallManager/1.0',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          // Don't throw on non-2xx status codes, we'll handle them
          validateStatus: (status) => status < 500,
          // Ignore self-signed certificate errors
          httpsAgent: new (require('https').Agent)({ 
            rejectUnauthorized: false 
          })
        }
      );
      
      // Consider 2xx and 3xx as success
      if (response.status >= 200 && response.status < 400) {
        const duration = Date.now() - startTime;
        console.log(`✅ Bot warmup successful on attempt ${attempts} (${duration}ms)`);
        console.log(`🎯 Warmup response status: ${response.status}`);
        console.log(`🆔 Session UUID ready: ${sessionUuid}`);
        
        return {
          success: true,
          attempts: attempts,
          duration: duration,
          status: response.status,
          sessionUuid: sessionUuid
        };
      } else {
        console.warn(`⚠️  Bot warmup attempt ${attempts} returned status ${response.status}`);
        
        // If this is the last attempt, return failure
        if (i === maxRetries - 1) {
          const duration = Date.now() - startTime;
          return {
            success: false,
            attempts: attempts,
            duration: duration,
            error: `Bot returned status ${response.status}`,
            lastStatus: response.status,
            sessionUuid: sessionUuid
          };
        }
      }
      
    } catch (error) {
      console.error(`❌ Bot warmup attempt ${attempts} failed:`, error.message);
      
      // If this is the last attempt, return failure
      if (i === maxRetries - 1) {
        const duration = Date.now() - startTime;
        return {
          success: false,
          attempts: attempts,
          duration: duration,
          error: error.message,
          errorCode: error.code,
          sessionUuid: sessionUuid
        };
      }
    }
    
    // Wait a bit before retry (exponential backoff)
    if (i < maxRetries - 1) {
      const waitTime = Math.min(1000 * Math.pow(2, i), 5000); // Max 5 seconds
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  // This should never be reached, but just in case
  const duration = Date.now() - startTime;
  return {
    success: false,
    attempts: attempts,
    duration: duration,
    error: 'Unexpected end of retry loop',
    sessionUuid: sessionUuid
  };
}

/**
 * Simple bot warmup without retry (for testing)
 * @param {string} wssUrl - WebSocket URL to extract base URL from
 * @param {string} agentId - Agent ID for the session
 * @returns {Promise<{success: boolean, status?: number, sessionUuid?: string, error?: string}>}
 */
async function warmupBot(wssUrl, agentId) {
  const timeout = parseInt(process.env.BOT_WARMUP_TIMEOUT) || 120000; // 120 seconds
  const warmupPath = process.env.BOT_WARMUP_URL || '/warmup';
  
  if (!wssUrl) {
    return { success: true, skipped: true };
  }
  
  if (!agentId) {
    return { success: false, error: 'Agent ID is required' };
  }
  
  // Extract base URL from WebSocket URL
  const baseUrl = extractBaseUrlFromWss(wssUrl);
  if (!baseUrl) {
    return { success: false, error: 'Could not extract base URL from WebSocket URL' };
  }
  
  // Generate UUID for this session
  const sessionUuid = uuid4();
  const warmupUrl = `${baseUrl}${warmupPath}/${sessionUuid}`;
  
  try {
    const response = await axios.post(warmupUrl,
      { agent_id: agentId },
      {
        timeout: timeout,
        headers: {
          'User-Agent': 'GlimpassCallManager/1.0',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        // Ignore self-signed certificate errors
        httpsAgent: new (require('https').Agent)({ 
          rejectUnauthorized: false 
        })
      }
    );
    
    return {
      success: response.status >= 200 && response.status < 400,
      status: response.status,
      sessionUuid: sessionUuid
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      errorCode: error.code,
      sessionUuid: sessionUuid
    };
  }
}

module.exports = {
  warmupBotWithRetry,
  warmupBot
};