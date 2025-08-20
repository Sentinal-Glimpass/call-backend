/**
 * Phone Provider Service
 * Manages phone number to provider mapping for multi-provider telephony system
 */

const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');

class PhoneProviderService {
  /**
   * Get the collection reference
   */
  static async getCollection() {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    return database.collection("phoneProviders");
  }

  /**
   * Get provider configuration for a phone number
   * @param {string} phoneNumber - Phone number (with or without + prefix)
   * @returns {Promise<Object>} Provider configuration
   */
  static async getProvider(phoneNumber) {
    try {
      // Normalize phone number - remove + and spaces
      const normalizedNumber = phoneNumber.replace(/^\+/, '').replace(/\s+/g, '');
      
      const collection = await this.getCollection();
      
      // Try exact match first
      let provider = await collection.findOne({ 
        phoneNumber: normalizedNumber, 
        isActive: true 
      });
      
      // If no exact match, try with + prefix
      if (!provider) {
        provider = await collection.findOne({ 
          phoneNumber: `+${normalizedNumber}`, 
          isActive: true 
        });
      }
      
      // Default fallback to Plivo if no mapping found
      if (!provider) {
        console.log(`📞 No provider mapping found for ${phoneNumber}, defaulting to Plivo`);
        return {
          _id: null,
          phoneNumber: normalizedNumber,
          provider: 'plivo',
          providerConfig: {
            accountSid: process.env.PLIVO_ACCOUNT_SID || 'MAMTBIYJUYNMRINGQ4ND',
            authToken: process.env.PLIVO_AUTH_TOKEN || 'default_token'
          },
          isActive: true,
          isDefault: true
        };
      }
      
      console.log(`📞 Found provider mapping: ${phoneNumber} → ${provider.provider}`);
      return provider;
      
    } catch (error) {
      console.error('❌ Error getting provider:', error);
      throw error;
    }
  }

  /**
   * Add a new phone number to provider mapping
   * @param {Object} mapping - Phone number mapping
   * @returns {Promise<Object>} Created mapping
   */
  static async addProvider(mapping) {
    try {
      const collection = await this.getCollection();
      
      // Normalize phone number
      const normalizedNumber = mapping.phoneNumber.replace(/^\+/, '').replace(/\s+/g, '');
      
      const providerMapping = {
        _id: new ObjectId(),
        phoneNumber: normalizedNumber,
        provider: mapping.provider, // 'plivo' or 'twilio'
        providerConfig: mapping.providerConfig,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await collection.insertOne(providerMapping);
      console.log(`✅ Added provider mapping: ${normalizedNumber} → ${mapping.provider}`);
      
      return {
        success: true,
        id: result.insertedId,
        mapping: providerMapping
      };
      
    } catch (error) {
      if (error.code === 11000) {
        console.error(`❌ Phone number ${mapping.phoneNumber} already exists`);
        return {
          success: false,
          error: 'Phone number already mapped to a provider'
        };
      }
      console.error('❌ Error adding provider:', error);
      throw error;
    }
  }

  /**
   * Update provider for a phone number
   * @param {string} phoneNumber - Phone number to update
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Update result
   */
  static async updateProvider(phoneNumber, updates) {
    try {
      const collection = await this.getCollection();
      const normalizedNumber = phoneNumber.replace(/^\+/, '').replace(/\s+/g, '');
      
      const result = await collection.updateOne(
        { phoneNumber: normalizedNumber },
        { 
          $set: { 
            ...updates, 
            updatedAt: new Date() 
          } 
        }
      );
      
      if (result.matchedCount === 0) {
        return { success: false, error: 'Phone number not found' };
      }
      
      console.log(`✅ Updated provider mapping for ${phoneNumber}`);
      return { success: true, modified: result.modifiedCount };
      
    } catch (error) {
      console.error('❌ Error updating provider:', error);
      throw error;
    }
  }

  /**
   * List all provider mappings
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of mappings
   */
  static async listProviders(options = {}) {
    try {
      const collection = await this.getCollection();
      
      const query = {};
      if (options.provider) query.provider = options.provider;
      if (options.isActive !== undefined) query.isActive = options.isActive;
      
      const mappings = await collection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(options.limit || 100)
        .toArray();
        
      return mappings;
      
    } catch (error) {
      console.error('❌ Error listing providers:', error);
      throw error;
    }
  }

  /**
   * Delete a provider mapping
   * @param {string} phoneNumber - Phone number to delete
   * @returns {Promise<Object>} Delete result
   */
  static async deleteProvider(phoneNumber) {
    try {
      const collection = await this.getCollection();
      const normalizedNumber = phoneNumber.replace(/^\+/, '').replace(/\s+/g, '');
      
      const result = await collection.deleteOne({ phoneNumber: normalizedNumber });
      
      if (result.deletedCount === 0) {
        return { success: false, error: 'Phone number not found' };
      }
      
      console.log(`✅ Deleted provider mapping for ${phoneNumber}`);
      return { success: true };
      
    } catch (error) {
      console.error('❌ Error deleting provider:', error);
      throw error;
    }
  }
}

module.exports = PhoneProviderService;