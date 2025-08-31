/**
 * Bot Warmup Utility
 * Ensures bot is ready before making Plivo calls
 */

const axios = require('axios');

/**
 * Warmup bot with retry logic
 * @param {string} warmupUrl - Bot warmup URL from environment
 * @returns {Promise<{success: boolean, attempts: number, duration: number, error?: string}>}
 */
async function warmupBotWithRetry(warmupUrl) {
  const maxRetries = parseInt(process.env.BOT_WARMUP_RETRIES) || 3;
  const timeout = parseInt(process.env.BOT_WARMUP_TIMEOUT) || 60000; // 60 seconds
  
  if (!warmupUrl) {
    console.warn('⚠️  BOT_WARMUP_URL not configured, skipping bot warmup');
    return { success: true, attempts: 0, duration: 0 };
  }
  
  // Convert relative URL to absolute URL if needed
  let fullWarmupUrl = warmupUrl;
  if (warmupUrl.startsWith('/')) {
    // Relative URL - construct full URL using BASE_URL or localhost
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 7999}`;
    fullWarmupUrl = `${baseUrl}${warmupUrl}`;
    console.log(`🔗 Converting relative warmup URL to: ${fullWarmupUrl}`);
  }
  
  let attempts = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < maxRetries; i++) {
    attempts++;
    
    try {
      console.log(`🤖 Bot warmup attempt ${attempts}/${maxRetries}...`);
      
      const response = await axios.get(fullWarmupUrl, {
        timeout: timeout,
        headers: {
          'User-Agent': 'GlimpassCallManager/1.0',
          'Accept': 'application/json'
        },
        // Don't throw on non-2xx status codes, we'll handle them
        validateStatus: (status) => status < 500
      });
      
      // Consider 2xx and 3xx as success
      if (response.status >= 200 && response.status < 400) {
        const duration = Date.now() - startTime;
        console.log(`✅ Bot warmup successful on attempt ${attempts} (${duration}ms)`);
        
        return {
          success: true,
          attempts: attempts,
          duration: duration,
          status: response.status
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
            lastStatus: response.status
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
          errorCode: error.code
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
    error: 'Unexpected end of retry loop'
  };
}

/**
 * Simple bot warmup without retry (for testing)
 * @param {string} warmupUrl - Bot warmup URL
 * @returns {Promise<{success: boolean, status?: number, error?: string}>}
 */
async function warmupBot(warmupUrl) {
  const timeout = parseInt(process.env.BOT_WARMUP_TIMEOUT) || 60000;
  
  if (!warmupUrl) {
    return { success: true, skipped: true };
  }
  
  try {
    const response = await axios.get(warmupUrl, {
      timeout: timeout,
      headers: {
        'User-Agent': 'GlimpassCallManager/1.0',
        'Accept': 'application/json'
      }
    });
    
    return {
      success: response.status >= 200 && response.status < 400,
      status: response.status
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      errorCode: error.code
    };
  }
}

/**
 * Warm up multiple pods in parallel to ensure concurrent calls hit warm instances
 * @param {string} warmupUrl - Bot warmup URL
 * @param {number} numPods - Number of pods to warm up (usually equals client's maxConcurrentCalls)
 * @returns {Promise<{success: boolean, successCount: number, totalPods: number, results: Array, duration: number}>}
 */
async function warmupMultiplePods(warmupUrl, numPods = 1) {
  if (!warmupUrl) {
    console.warn('⚠️  BOT_WARMUP_URL not configured, skipping multi-pod warmup');
    return { success: true, successCount: 0, totalPods: 0, results: [], duration: 0 };
  }

  // Convert relative URL to absolute URL if needed
  let fullWarmupUrl = warmupUrl;
  if (warmupUrl.startsWith('/')) {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 7999}`;
    fullWarmupUrl = `${baseUrl}${warmupUrl}`;
    console.log(`🔗 Converting relative warmup URL to: ${fullWarmupUrl}`);
  }

  console.log(`🤖 Starting parallel warmup for ${numPods} pods...`);
  const startTime = Date.now();

  // Create array of warmup promises
  const warmupPromises = Array.from({ length: numPods }, (_, index) => 
    warmupBotWithRetry(fullWarmupUrl).then(result => ({
      podIndex: index + 1,
      ...result
    }))
  );

  try {
    // Execute all warmups in parallel
    const results = await Promise.all(warmupPromises);
    const duration = Date.now() - startTime;
    
    // Count successful warmups
    const successCount = results.filter(r => r.success).length;
    const failureCount = numPods - successCount;

    console.log(`🔥 Multi-pod warmup completed: ${successCount}/${numPods} pods ready (${duration}ms)`);
    
    if (failureCount > 0) {
      console.warn(`⚠️  ${failureCount} pods failed to warm up`);
      results.filter(r => !r.success).forEach(result => {
        console.warn(`   Pod ${result.podIndex}: ${result.error}`);
      });
    }

    return {
      success: successCount > 0, // At least one pod must be warm
      successCount,
      totalPods: numPods,
      results,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('❌ Multi-pod warmup failed:', error.message);
    
    return {
      success: false,
      successCount: 0,
      totalPods: numPods,
      results: [],
      duration,
      error: error.message
    };
  }
}

module.exports = {
  warmupBotWithRetry,
  warmupBot,
  warmupMultiplePods
};