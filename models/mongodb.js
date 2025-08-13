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
  serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  connectTimeoutMS: 10000, // Give up initial connection after 10 seconds
  family: 4 // Use IPv4, skip trying IPv6
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
    await client.connect();
    // Test the connection
    await client.db().admin().ping();
    isConnected = true;
    console.log("✅ Connected to MongoDB with connection pool!");
  } catch (error) {
    console.error("❌ Error connecting to MongoDB:", error);
    isConnected = false;
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
