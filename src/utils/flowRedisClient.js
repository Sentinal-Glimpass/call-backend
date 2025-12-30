/**
 * Flow Redis Client Utility
 *
 * Provides Redis connection management for flow-related data stored in Redis db=3.
 * This is separate from other Redis usage to keep flow data isolated.
 */

const { createClient } = require('redis');

let flowRedisClient = null;

/**
 * Get or create Redis client for flow data (db=3)
 * @returns {Promise<RedisClient>} Redis client connected to db=3
 */
async function getFlowRedisClient() {
    if (flowRedisClient && flowRedisClient.isOpen) {
        return flowRedisClient;
    }

    const redisHost = process.env.REDIS_HOST || '10.50.107.67';
    const redisPort = process.env.REDIS_PORT || 6379;

    flowRedisClient = createClient({
        socket: {
            host: redisHost,
            port: redisPort
        },
        database: 3, // Flow prompts database
        // Add retry strategy
        socket: {
            host: redisHost,
            port: redisPort,
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    console.error('Redis reconnection failed after 10 attempts');
                    return new Error('Redis reconnection limit exceeded');
                }
                // Exponential backoff: 50ms, 100ms, 200ms, etc.
                return Math.min(retries * 50, 3000);
            }
        }
    });

    flowRedisClient.on('error', (err) => {
        console.error('Flow Redis Client Error:', err);
    });

    flowRedisClient.on('connect', () => {
        console.log('Flow Redis client connected to db=3');
    });

    flowRedisClient.on('reconnecting', () => {
        console.log('Flow Redis client reconnecting...');
    });

    await flowRedisClient.connect();

    return flowRedisClient;
}

/**
 * Scan Redis keys matching a pattern
 * Uses SCAN command to efficiently iterate over keys without blocking
 *
 * @param {RedisClient} client - Redis client instance
 * @param {string} pattern - Pattern to match (e.g., "flow:*:prompt:*")
 * @param {number} count - Number of keys to return per iteration (default: 100)
 * @returns {Promise<string[]>} Array of matching keys
 */
async function scanRedisKeys(client, pattern, count = 100) {
    const keys = [];
    let cursor = 0;

    do {
        const result = await client.scan(cursor, {
            MATCH: pattern,
            COUNT: count
        });

        cursor = result.cursor;
        keys.push(...result.keys);
    } while (cursor !== 0);

    return keys;
}

/**
 * Close the Redis connection
 * Should be called during application shutdown
 */
async function closeFlowRedisClient() {
    if (flowRedisClient && flowRedisClient.isOpen) {
        await flowRedisClient.quit();
        flowRedisClient = null;
        console.log('Flow Redis client disconnected');
    }
}

/**
 * Get all flows from the registry
 * @returns {Promise<string[]>} Array of flow names
 */
async function getRegisteredFlows() {
    try {
        const client = await getFlowRedisClient();
        const flows = await client.sMembers('flows:registry');
        return flows || [];
    } catch (error) {
        console.error('Error getting registered flows:', error);
        return [];
    }
}

/**
 * Check if a flow exists in the registry
 * @param {string} flowName - Flow name to check
 * @returns {Promise<boolean>} True if flow exists
 */
async function flowExists(flowName) {
    try {
        const client = await getFlowRedisClient();
        return await client.sIsMember('flows:registry', flowName);
    } catch (error) {
        console.error('Error checking flow existence:', error);
        return false;
    }
}

module.exports = {
    getFlowRedisClient,
    scanRedisKeys,
    closeFlowRedisClient,
    getRegisteredFlows,
    flowExists
};
