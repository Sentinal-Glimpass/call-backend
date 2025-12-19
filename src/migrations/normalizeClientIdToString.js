/**
 * Migration Script: Normalize clientId to String in plivoHangupData
 *
 * This script converts all clientId values to strings for consistent querying.
 * Run this once to fix historical data that may have clientId stored as ObjectId.
 *
 * Usage: node src/migrations/normalizeClientIdToString.js
 */

// Load environment variables from .env file
require('dotenv').config();

const { ObjectId } = require('mongodb');
const { connectToMongo, closeMongoConnection, client } = require('../../models/mongodb.js');

const DB_NAME = 'talkGlimpass';

async function runMigration() {
  console.log('='.repeat(60));
  console.log('Migration: Normalize clientId to String in plivoHangupData');
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('');

  try {
    await connectToMongo();
    console.log('✅ Connected to MongoDB');

    const database = client.db(DB_NAME);
    const hangupCollection = database.collection('plivoHangupData');

    // Get total count for progress tracking
    const totalCount = await hangupCollection.countDocuments({});
    console.log(`📊 Total records in plivoHangupData: ${totalCount}`);
    console.log('');

    // Statistics
    const stats = {
      totalProcessed: 0,
      alreadyString: 0,
      convertedFromObjectId: 0,
      convertedFromOther: 0,
      nullOrMissing: 0,
      errors: 0,
      byCampId: {}
    };

    // Process in batches to avoid memory issues
    const batchSize = 1000;
    let skip = 0;
    let hasMore = true;

    console.log('🔄 Processing records...');
    console.log('');

    while (hasMore) {
      const batch = await hangupCollection.find({})
        .skip(skip)
        .limit(batchSize)
        .toArray();

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      for (const doc of batch) {
        stats.totalProcessed++;

        // Track by campId
        const campId = doc.campId || 'unknown';
        if (!stats.byCampId[campId]) {
          stats.byCampId[campId] = { total: 0, converted: 0 };
        }
        stats.byCampId[campId].total++;

        // Check if clientId needs conversion
        if (doc.clientId === null || doc.clientId === undefined) {
          stats.nullOrMissing++;
          continue;
        }

        if (typeof doc.clientId === 'string') {
          stats.alreadyString++;
          continue;
        }

        // Need to convert
        try {
          let newClientId;

          if (doc.clientId instanceof ObjectId ||
              (doc.clientId._bsontype && doc.clientId._bsontype === 'ObjectId')) {
            // It's an ObjectId
            newClientId = doc.clientId.toString();
            stats.convertedFromObjectId++;
          } else if (typeof doc.clientId === 'object' && doc.clientId.toString) {
            // Some other object with toString method
            newClientId = doc.clientId.toString();
            stats.convertedFromOther++;
          } else {
            // Fallback: use String()
            newClientId = String(doc.clientId);
            stats.convertedFromOther++;
          }

          // Update the document
          await hangupCollection.updateOne(
            { _id: doc._id },
            { $set: { clientId: newClientId } }
          );

          stats.byCampId[campId].converted++;

          // Log progress every 100 conversions
          const totalConverted = stats.convertedFromObjectId + stats.convertedFromOther;
          if (totalConverted % 100 === 0) {
            console.log(`   Converted ${totalConverted} records...`);
          }
        } catch (error) {
          stats.errors++;
          console.error(`   ❌ Error converting record ${doc._id}: ${error.message}`);
        }
      }

      skip += batchSize;

      // Progress indicator
      const progress = Math.min(100, Math.round((skip / totalCount) * 100));
      process.stdout.write(`\r   Progress: ${progress}% (${Math.min(skip, totalCount)}/${totalCount})`);
    }

    console.log('\n');
    console.log('='.repeat(60));
    console.log('Migration Summary');
    console.log('='.repeat(60));
    console.log(`Total records processed: ${stats.totalProcessed}`);
    console.log(`Already string (no change): ${stats.alreadyString}`);
    console.log(`Converted from ObjectId: ${stats.convertedFromObjectId}`);
    console.log(`Converted from other types: ${stats.convertedFromOther}`);
    console.log(`Null or missing clientId: ${stats.nullOrMissing}`);
    console.log(`Errors: ${stats.errors}`);
    console.log('');
    console.log('Breakdown by campId:');
    console.log('-'.repeat(40));

    // Sort campIds for better readability
    const sortedCampIds = Object.keys(stats.byCampId).sort();
    for (const campId of sortedCampIds) {
      const campStats = stats.byCampId[campId];
      console.log(`  ${campId}: ${campStats.total} records, ${campStats.converted} converted`);
    }

    console.log('');
    console.log(`✅ Migration completed at: ${new Date().toISOString()}`);

    // Return stats for programmatic use
    return {
      success: true,
      stats
    };

  } catch (error) {
    console.error('❌ Migration failed:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    await closeMongoConnection();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run the migration
runMigration()
  .then(result => {
    if (result.success) {
      console.log('\n✅ Migration successful!');
      process.exit(0);
    } else {
      console.error('\n❌ Migration failed:', result.error);
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
  });
