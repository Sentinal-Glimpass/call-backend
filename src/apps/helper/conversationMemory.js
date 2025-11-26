/**
 * Conversation Memory Helper Functions
 * Manages conversation context at client and assistant levels
 */

const { connectToMongo, client } = require('../../../models/mongodb.js');
const { ObjectId } = require('mongodb');

/**
 * Normalize phone number to last 10 digits for consistent matching
 * @param {string} phoneNumber - Phone number to normalize
 * @returns {string} Last 10 digits
 */
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  // Remove all non-digit characters and get last 10 digits
  const digits = phoneNumber.replace(/\D/g, '');
  return digits.slice(-10);
}

/**
 * Save or update conversation context
 * @param {Object} memoryData - Memory data to save
 * @returns {Promise<Object>} Result object
 */
async function saveConversationContext(memoryData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const memoryCollection = database.collection("conversationMemory");

    const { phoneNumber, clientId, assistantId, globalContext, agentContext } = memoryData;

    // Validate required fields
    if (!phoneNumber || !clientId || !assistantId) {
      return {
        status: 400,
        success: false,
        message: 'Required fields: phoneNumber, clientId, assistantId'
      };
    }

    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    // Build query for upsert
    const query = {
      phoneNumber: normalizedPhone,
      clientId: new ObjectId(clientId),
      assistantId: new ObjectId(assistantId)
    };

    // Build update object - only update provided fields
    const updateFields = {
      updatedAt: new Date()
    };

    if (globalContext !== undefined) {
      updateFields.globalContext = globalContext;
    }

    if (agentContext !== undefined) {
      updateFields.agentContext = agentContext;
    }

    // Upsert: update if exists, insert if not
    const result = await memoryCollection.updateOne(
      query,
      {
        $set: updateFields,
        $setOnInsert: {
          phoneNumber: normalizedPhone,
          clientId: new ObjectId(clientId),
          assistantId: new ObjectId(assistantId),
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    console.log(`✅ Conversation memory saved for ${normalizedPhone} (${result.matchedCount > 0 ? 'updated' : 'created'})`);

    return {
      status: 200,
      success: true,
      message: 'Conversation context saved successfully',
      upserted: result.upsertedCount > 0,
      updated: result.modifiedCount > 0
    };

  } catch (error) {
    console.error('❌ Error saving conversation context:', error);
    return {
      status: 500,
      success: false,
      message: 'Internal server error',
      error: error.message
    };
  }
}

/**
 * Get conversation context for a phone number
 * @param {Object} query - Query parameters
 * @returns {Promise<Object>} Memory data or null
 */
async function getConversationContext(query) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const memoryCollection = database.collection("conversationMemory");

    const { phoneNumber, clientId, assistantId } = query;

    if (!phoneNumber || !clientId) {
      return null;
    }

    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    const memoryQuery = {
      phoneNumber: normalizedPhone,
      clientId: new ObjectId(clientId)
    };

    // If assistantId is provided, add it to query for agent-specific context
    if (assistantId) {
      memoryQuery.assistantId = new ObjectId(assistantId);
    }

    const memory = await memoryCollection.findOne(memoryQuery);
    return memory;

  } catch (error) {
    console.error('❌ Error fetching conversation context:', error);
    return null;
  }
}

/**
 * Delete conversation context
 * @param {Object} query - Query parameters
 * @returns {Promise<Object>} Result object
 */
async function deleteConversationContext(query) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const memoryCollection = database.collection("conversationMemory");

    const { phoneNumber, clientId, assistantId } = query;

    if (!phoneNumber || !clientId) {
      return {
        status: 400,
        success: false,
        message: 'Required fields: phoneNumber, clientId'
      };
    }

    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    const deleteQuery = {
      phoneNumber: normalizedPhone,
      clientId: new ObjectId(clientId)
    };

    if (assistantId) {
      deleteQuery.assistantId = new ObjectId(assistantId);
    }

    const result = await memoryCollection.deleteOne(deleteQuery);

    return {
      status: 200,
      success: true,
      message: 'Conversation context deleted',
      deleted: result.deletedCount > 0
    };

  } catch (error) {
    console.error('❌ Error deleting conversation context:', error);
    return {
      status: 500,
      success: false,
      message: 'Internal server error',
      error: error.message
    };
  }
}

module.exports = {
  normalizePhoneNumber,
  saveConversationContext,
  getConversationContext,
  deleteConversationContext
};
