/**
 * Script to create MongoDB indexes for conversationMemory collection
 * Run this after implementing the memory system
 */

const { connectToMongo, client } = require('../models/mongodb.js');

async function createMemoryIndexes() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await connectToMongo();

    const database = client.db("talkGlimpass");
    const memoryCollection = database.collection("conversationMemory");

    console.log('📋 Creating indexes for conversationMemory collection...\n');

    // Index 1: For global context lookups (phoneNumber + clientId)
    console.log('Creating index: global_context_lookup...');
    const index1 = await memoryCollection.createIndex(
      { phoneNumber: 1, clientId: 1 },
      { name: "global_context_lookup" }
    );
    console.log(`✅ Created: ${index1}\n`);

    // Index 2: For agent-specific context lookups (phoneNumber + clientId + assistantId)
    console.log('Creating index: agent_context_lookup...');
    const index2 = await memoryCollection.createIndex(
      { phoneNumber: 1, clientId: 1, assistantId: 1 },
      { name: "agent_context_lookup" }
    );
    console.log(`✅ Created: ${index2}\n`);

    // List all indexes to verify
    console.log('📊 All indexes on conversationMemory collection:');
    const indexes = await memoryCollection.indexes();
    indexes.forEach(index => {
      console.log(`   - ${index.name}:`, JSON.stringify(index.key));
    });

    console.log('\n✅ All indexes created successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    process.exit(1);
  }
}

// Run the script
createMemoryIndexes();
