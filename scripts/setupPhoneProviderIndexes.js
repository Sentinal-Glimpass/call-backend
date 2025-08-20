/**
 * Setup MongoDB indexes for phoneProviders collection
 * Run this script to create necessary indexes for optimal performance
 */

const { connectToMongo, client } = require('../models/mongodb.js');

async function setupPhoneProviderIndexes() {
  try {
    console.log('🔍 Setting up phoneProviders collection indexes...');
    
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("phoneProviders");
    
    // Create unique index on phoneNumber
    await collection.createIndex(
      { phoneNumber: 1 },
      { 
        unique: true,
        name: 'phoneNumber_unique'
      }
    );
    console.log('✅ Created unique index on phoneNumber');
    
    // Create compound index for active provider lookups
    await collection.createIndex(
      { phoneNumber: 1, isActive: 1 },
      { 
        name: 'phoneNumber_isActive'
      }
    );
    console.log('✅ Created compound index on phoneNumber + isActive');
    
    // Create index on provider for filtering
    await collection.createIndex(
      { provider: 1 },
      { 
        name: 'provider_index'
      }
    );
    console.log('✅ Created index on provider');
    
    // Create index on createdAt for sorting
    await collection.createIndex(
      { createdAt: -1 },
      { 
        name: 'createdAt_desc'
      }
    );
    console.log('✅ Created index on createdAt');
    
    console.log('🎉 Phone provider indexes setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error setting up indexes:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

// Run the setup if called directly
if (require.main === module) {
  setupPhoneProviderIndexes();
}

module.exports = setupPhoneProviderIndexes;