const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

// MongoDB connection from environment variable
const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI environment variable is required');
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10, // Maximum number of connections in the pool
  serverSelectionTimeoutMS: 30000, // Increased to 30 seconds for better reliability
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  connectTimeoutMS: 30000, // Increased to 30 seconds for initial connection
  family: 4, // Use IPv4, skip trying IPv6
  retryWrites: true, // Enable retryable writes
  retryReads: true, // Enable retryable reads
  maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
  heartbeatFrequencyMS: 10000, // Check server status every 10 seconds
});

// Connection state management
let isConnecting = false;
let isConnected = false;

async function connectToMongo() {
  // Return immediately if already connected
  if (isConnected) {
    return;
  }
  
  // If connection is in progress, wait for it
  if (isConnecting) {
    while (isConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }
  
  isConnecting = true;
  
  try {
    console.log("🔄 Attempting to connect to MongoDB...");
    await client.connect();
    // Test the connection
    await client.db().admin().ping();
    isConnected = true;
    console.log("✅ Connected to MongoDB with connection pool!");
  } catch (error) {
    console.error("❌ Error connecting to MongoDB:", error.message);
    console.error("🔍 Connection details:", {
      servers: error.reason?.servers ? Array.from(error.reason.servers.keys()) : 'unknown',
      type: error.reason?.type || 'unknown'
    });
    isConnected = false;
    
    // Add retry logic for transient connection issues
    if (error.name === 'MongoServerSelectionError') {
      console.log("🔄 Retrying MongoDB connection in 5 seconds...");
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        await client.connect();
        await client.db().admin().ping();
        isConnected = true;
        console.log("✅ Connected to MongoDB on retry!");
        return;
      } catch (retryError) {
        console.error("❌ Retry failed:", retryError.message);
      }
    }
    
    throw error;
  } finally {
    isConnecting = false;
  }
}

async function closeMongoConnection() {
  try {
    if (isConnected) {
      await client.close();
      isConnected = false;
      console.log("🔒 MongoDB connection closed.");
    }
  } catch (error) {
    console.error("❌ Error closing MongoDB connection:", error);
  }
}

module.exports = { connectToMongo, closeMongoConnection, client };
