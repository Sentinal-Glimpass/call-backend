/**
 * Telephony Credentials Service
 * Manages client-specific telephony provider credentials (Plivo/Twilio)
 * Supports multi-tenant telephony with secure credential storage
 */

const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const ProviderMetadataService = require('./providerMetadataService');

class TelephonyCredentialsService {
  /**
   * Get the collection reference
   */
  static async getCollection() {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    return database.collection("telephonyCredentials");
  }

  /**
   * Get telephony credentials for a client and provider
   * @param {string} clientId - Client ObjectId
   * @param {string} provider - Provider name
   * @returns {Promise<Object>} Decrypted credentials or default
   */
  static async getCredentials(clientId, provider) {
    try {
      const collection = await this.getCollection();
      
      console.log(`🔍 CREDENTIALS SERVICE - Looking for credentials: clientId=${clientId}, provider=${provider}`);
      
      // Try to find client-specific credentials
      const credentialRecord = await collection.findOne({
        clientId: new ObjectId(clientId),
        provider: provider,
        isActive: true
      });
      
      console.log(`🔍 CREDENTIALS SERVICE - Found credential record:`, !!credentialRecord);
      if (credentialRecord) {
        console.log(`🔍 CREDENTIALS SERVICE - Raw credential record:`, JSON.stringify(credentialRecord, null, 2));
      }
      
      if (credentialRecord) {
        console.log(`🔐 Using client-specific ${provider} credentials for client ${clientId}`);
        
        // Decrypt all credentials
        const decryptedCredentials = {};
        
        // Handle both old format (nested under 'credentials') and new format (direct fields)
        if (credentialRecord.credentials) {
          // New format: credentials are nested
          for (const [key, value] of Object.entries(credentialRecord.credentials)) {
            decryptedCredentials[key] = this.decrypt(value);
          }
        } else {
          // Legacy format: credentials are direct fields on the record
          const credentialFields = ['accountSid', 'authToken', 'accessToken', 'instanceId', 'phoneNumbers'];
          for (const field of credentialFields) {
            if (credentialRecord[field]) {
              if (field === 'phoneNumbers' && typeof credentialRecord[field] === 'string') {
                // Don't decrypt phone numbers, they're stored as plain text
                decryptedCredentials[field] = credentialRecord[field];
              } else {
                decryptedCredentials[field] = this.decrypt(credentialRecord[field]);
              }
            }
          }
        }
        
        console.log(`🔍 CREDENTIALS SERVICE - Decrypted credentials keys:`, Object.keys(decryptedCredentials));
        
        return {
          clientId: clientId,
          provider: provider,
          ...decryptedCredentials,
          metadata: credentialRecord.metadata,
          isClientSpecific: true,
          lastUsed: credentialRecord.lastUsed,
          validatedPhoneNumbers: credentialRecord.validationResult?.phoneNumbers || []
        };
      }
      
      // Fallback to system default credentials
      console.log(`🔄 Using system default ${provider} credentials for client ${clientId}`);
      return this.getSystemDefaultCredentials(provider, clientId);
      
    } catch (error) {
      console.error('❌ Error getting telephony credentials:', error);
      // Fallback to system defaults on error
      return this.getSystemDefaultCredentials(provider, clientId);
    }
  }

  /**
   * Add telephony credentials for a client
   * @param {Object} credentialsData - Credentials data
   * @returns {Promise<Object>} Result
   */
  static async addCredentials(credentialsData) {
    try {
      const collection = await this.getCollection();
      const { clientId, provider } = credentialsData;
      
      // Validate required fields
      if (!clientId || !provider) {
        return {
          success: false,
          error: 'Missing required fields: clientId, provider'
        };
      }
      
      // Get provider configuration and validate all required fields
      const providerConfig = ProviderMetadataService.getProviderConfig(provider);
      if (!providerConfig) {
        return {
          success: false,
          error: `Unsupported provider: ${provider}`
        };
      }
      
      // Extract credentials based on provider configuration
      const credentials = {};
      const encryptedCredentials = {};
      
      // Process all required and optional fields
      [...providerConfig.requiredFields, ...providerConfig.optionalFields].forEach(field => {
        if (credentialsData[field.key] !== undefined) {
          credentials[field.key] = credentialsData[field.key];
          
          // Encrypt sensitive fields (password type or contains 'token', 'key', 'secret')
          if (field.type === 'password' || 
              field.key.toLowerCase().includes('token') ||
              field.key.toLowerCase().includes('key') ||
              field.key.toLowerCase().includes('secret')) {
            encryptedCredentials[field.key] = this.encrypt(credentialsData[field.key]);
          } else {
            encryptedCredentials[field.key] = credentialsData[field.key];
          }
        }
      });
      
      // Check if credentials already exist for this client+provider
      const existing = await collection.findOne({
        clientId: new ObjectId(clientId),
        provider: provider
      });
      
      if (existing) {
        return {
          success: false,
          error: `${provider} credentials already exist for this client. Use update instead.`
        };
      }
      
      // Validate credentials format using dynamic metadata
      const validation = this.validateCredentials(provider, credentials);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.errors ? validation.errors.join(', ') : 'Validation failed'
        };
      }
      
      const credentialsRecord = {
        _id: new ObjectId(),
        clientId: new ObjectId(clientId),
        provider: provider,
        
        // Store all credentials (encrypted sensitive ones)
        credentials: encryptedCredentials,
        
        // Additional metadata
        metadata: {
          ...credentialsData.metadata,
          providerVersion: providerConfig.version || '1.0',
          capabilities: providerConfig.capabilities
        },
        
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsed: null,
        lastValidated: null,
        validationResult: null
      };
      
      const result = await collection.insertOne(credentialsRecord);
      
      console.log(`✅ Added ${provider} credentials for client ${clientId}`);
      
      // Mask the first credential for response
      const firstRequiredField = providerConfig.requiredFields[0];
      const maskedValue = credentials[firstRequiredField.key] ? 
        this.maskCredential(credentials[firstRequiredField.key]) : 'configured';
      
      return {
        success: true,
        id: result.insertedId,
        provider: provider,
        [firstRequiredField.key]: maskedValue
      };
      
    } catch (error) {
      console.error('❌ Error adding telephony credentials:', error);
      throw error;
    }
  }

  /**
   * Update telephony credentials for a client
   * @param {string} clientId - Client ObjectId
   * @param {string} provider - Provider name
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Result
   */
  static async updateCredentials(clientId, provider, updates) {
    try {
      const collection = await this.getCollection();
      
      const updateData = {
        updatedAt: new Date()
      };
      
      // Encrypt sensitive fields if provided - use dot notation for nested credentials
      if (updates.accountSid) {
        const validation = this.validateCredentials(provider, updates);
        if (!validation.valid) {
          return {
            success: false,
            error: validation.error
          };
        }
        updateData['credentials.accountSid'] = this.encrypt(updates.accountSid);
      }

      if (updates.authToken) {
        updateData['credentials.authToken'] = this.encrypt(updates.authToken);
      }
      
      // Handle other fields
      if (updates.phoneNumbers !== undefined) updateData.phoneNumbers = updates.phoneNumbers;
      if (updates.metadata !== undefined) updateData.metadata = updates.metadata;
      if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
      if (updates.lastValidated !== undefined) updateData.lastValidated = updates.lastValidated;
      if (updates.validationResult !== undefined) updateData.validationResult = updates.validationResult;
      
      const result = await collection.updateOne(
        { 
          clientId: new ObjectId(clientId),
          provider: provider
        },
        { $set: updateData }
      );
      
      if (result.matchedCount === 0) {
        return {
          success: false,
          error: `No ${provider} credentials found for client ${clientId}`
        };
      }
      
      console.log(`✅ Updated ${provider} credentials for client ${clientId}`);
      return { success: true };
      
    } catch (error) {
      console.error('❌ Error updating telephony credentials:', error);
      throw error;
    }
  }

  /**
   * List telephony credentials for a client (masked for security)
   * @param {string} clientId - Client ObjectId
   * @returns {Promise<Array>} List of credentials (masked)
   */
  static async listClientCredentials(clientId) {
    try {
      const collection = await this.getCollection();
      
      const credentials = await collection
        .find({ clientId: new ObjectId(clientId) })
        .sort({ provider: 1 })
        .toArray();
        
      return credentials.map(cred => {
        const maskedCredentials = {};
        
        // Mask all credential fields
        if (cred.credentials) {
          for (const [key, value] of Object.entries(cred.credentials)) {
            const decryptedValue = this.decrypt(value);
            maskedCredentials[key] = this.maskCredential(decryptedValue);
          }
        }
        
        return {
          id: cred._id,
          provider: cred.provider,
          credentials: maskedCredentials,
          metadata: cred.metadata,
          isActive: cred.isActive,
          createdAt: cred.createdAt,
          lastUsed: cred.lastUsed,
          lastValidated: cred.lastValidated,
          validationStatus: cred.validationResult ? {
            valid: cred.validationResult.valid,
            testedAt: cred.validationResult.testedAt,
            account: cred.validationResult.account
          } : null
        };
      });
      
    } catch (error) {
      console.error('❌ Error listing client credentials:', error);
      throw error;
    }
  }

  /**
   * Delete telephony credentials
   * @param {string} clientId - Client ObjectId
   * @param {string} provider - Provider name
   * @returns {Promise<Object>} Result
   */
  static async deleteCredentials(clientId, provider) {
    try {
      const collection = await this.getCollection();
      
      const result = await collection.deleteOne({
        clientId: new ObjectId(clientId),
        provider: provider
      });
      
      if (result.deletedCount === 0) {
        return {
          success: false,
          error: `No ${provider} credentials found for client ${clientId}`
        };
      }
      
      console.log(`✅ Deleted ${provider} credentials for client ${clientId}`);
      return { success: true };
      
    } catch (error) {
      console.error('❌ Error deleting telephony credentials:', error);
      throw error;
    }
  }

  /**
   * Update last used timestamp
   * @param {string} clientId - Client ObjectId
   * @param {string} provider - Provider name
   */
  static async updateLastUsed(clientId, provider) {
    try {
      const collection = await this.getCollection();
      
      await collection.updateOne(
        { 
          clientId: new ObjectId(clientId),
          provider: provider
        },
        { $set: { lastUsed: new Date() } }
      );
      
    } catch (error) {
      console.error('❌ Error updating last used timestamp:', error);
      // Don't throw - this is non-critical
    }
  }

  /**
   * Get all credentials for a client (used by tools services)
   * @param {string} clientId - Client ObjectId
   * @returns {Promise<Object>} All client credentials by provider
   */
  static async getClientCredentials(clientId) {
    try {
      console.log(`🔍 Getting all credentials for client: ${clientId}`);

      const collection = await this.getCollection();

      // Get all active credentials for this client
      const credentialRecords = await collection.find({
        clientId: new ObjectId(clientId),
        isActive: true
      }).toArray();

      console.log(`🔍 Found ${credentialRecords.length} credential records`);

      const allCredentials = {};

      // Process each provider's credentials
      for (const record of credentialRecords) {
        const decryptedCredentials = {};

        // Decrypt all credential fields
        for (const [key, value] of Object.entries(record.credentials || {})) {
          decryptedCredentials[key] = this.decrypt(value);
        }

        allCredentials[record.provider] = decryptedCredentials;
        console.log(`✅ Added ${record.provider} credentials for client ${clientId}`);
      }

      return allCredentials;

    } catch (error) {
      console.error('❌ Error getting client credentials:', error);
      return {};
    }
  }

  /**
   * Get system default credentials
   * @param {string} provider - Provider name
   * @param {string} clientId - Client ID for logging
   * @returns {Object} Default credentials
   */
  static getSystemDefaultCredentials(provider, clientId) {
    const defaultCredentials = {
      plivo: {
        accountSid: process.env.PLIVO_ACCOUNT_SID || 'default_plivo_sid',
        authToken: process.env.PLIVO_AUTH_TOKEN || 'default_token'
      },
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || 'AC_default_sid',
        authToken: process.env.TWILIO_AUTH_TOKEN || 'default_token'
      },
      wati: {
        wati_api_key: process.env.WATI_API_KEY || 'default_wati_key',
        wati_instance_id: process.env.WATI_INSTANCE_ID || 'default_instance'
      },
      email: {
        gmail_user: process.env.GMAIL_USER || 'default@gmail.com',
        gmail_password: process.env.GMAIL_PASSWORD || 'default_password'
      }
    };
    
    const providerDefaults = defaultCredentials[provider];
    if (!providerDefaults) {
      console.warn(`⚠️ No default credentials configured for provider: ${provider}`);
      return {
        clientId: clientId,
        provider: provider,
        isClientSpecific: false,
        isDefault: true,
        error: `Provider ${provider} not configured`
      };
    }
    
    return {
      clientId: clientId,
      provider: provider,
      ...providerDefaults,
      isClientSpecific: false,
      isDefault: true
    };
  }

  /**
   * Validate credentials format using dynamic metadata
   * @param {string} provider - Provider name
   * @param {Object} credentials - Credentials to validate
   * @returns {Object} Validation result
   */
  static validateCredentials(provider, credentials) {
    // Use dynamic validation from metadata service
    return ProviderMetadataService.validateCredentials(provider, credentials);
  }

  /**
   * Encrypt sensitive data
   * @param {string} text - Text to encrypt
   * @returns {string} Encrypted text
   */
  static encrypt(text) {
    if (!text) return text;
    
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(this.getEncryptionKey().padEnd(32, '0').slice(0, 32));
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get the authentication tag for GCM
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt sensitive data
   * @param {string} encryptedText - Encrypted text
   * @returns {string} Decrypted text
   */
  static decrypt(encryptedText) {
    if (!encryptedText || typeof encryptedText !== 'string') {
      return encryptedText; // Return as-is if not a string
    }
    
    // Check if it's in new format (iv:authTag:encrypted) or old format (iv:encrypted)
    const parts = encryptedText.split(':');
    if (parts.length < 2) {
      return encryptedText; // Return as-is if not encrypted format
    }
    
    try {
      const algorithm = 'aes-256-gcm';
      const key = Buffer.from(this.getEncryptionKey().padEnd(32, '0').slice(0, 32));
      
      if (parts.length === 3) {
        // New format: iv:authTag:encrypted
        const [ivHex, authTagHex, encrypted] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
      } else {
        // Old format or legacy data - return as-is for backward compatibility
        console.warn('⚠️ Legacy credential format detected, returning as-is');
        return encryptedText;
      }
    } catch (error) {
      console.warn('⚠️ Failed to decrypt credential, returning as-is');
      return encryptedText;
    }
  }

  /**
   * Get encryption key from environment
   * @returns {string} Encryption key
   */
  static getEncryptionKey() {
    return process.env.TELEPHONY_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  /**
   * Mask credential for display
   * @param {string} credential - Credential to mask
   * @returns {string} Masked credential
   */
  static maskCredential(credential) {
    if (!credential || credential.length < 8) return credential;
    
    const start = credential.substring(0, 4);
    const end = credential.substring(credential.length - 4);
    const middle = '*'.repeat(Math.max(0, credential.length - 8));
    
    return `${start}${middle}${end}`;
  }
}

module.exports = TelephonyCredentialsService;