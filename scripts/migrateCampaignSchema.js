/**
 * Campaign Collection Schema Migration Script
 * 
 * This script safely migrates the plivoCampaign collection to add new fields
 * required for pause/resume functionality and heartbeat-based container management.
 * 
 * Run with: node scripts/migrateCampaignSchema.js
 */

const { connectToMongo, client } = require('../models/mongodb');
const { ObjectId } = require('mongodb');

class CampaignSchemaMigrator {
  constructor() {
    this.database = null;
    this.migrationResults = {
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      startTime: null,
      endTime: null
    };
  }

  async initialize() {
    try {
      await connectToMongo();
      this.database = client.db("talkGlimpass");
      console.log('✅ Connected to MongoDB database: talkGlimpass');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async validateBeforeMigration() {
    console.log('\n🔍 Validating database state before migration...');
    
    const campaignCollection = this.database.collection('plivoCampaign');
    const totalCampaigns = await campaignCollection.countDocuments({});
    
    console.log(`📊 Total campaigns to process: ${totalCampaigns}`);

    // Check if migration has already been run
    const campaignsWithStatus = await campaignCollection.countDocuments({ 
      status: { $exists: true } 
    });
    
    if (campaignsWithStatus > 0) {
      console.log(`⚠️  Warning: ${campaignsWithStatus} campaigns already have status field`);
      console.log('🤔 This might indicate partial or complete migration already done');
      
      const proceed = await this.promptContinue();
      if (!proceed) {
        console.log('❌ Migration cancelled by user');
        return false;
      }
    }

    // Sample current schema
    const sampleCampaign = await campaignCollection.findOne({});
    if (sampleCampaign) {
      console.log('\n📋 Current schema sample:');
      console.log(`  - ${Object.keys(sampleCampaign).join(', ')}`);
    }

    return true;
  }

  async promptContinue() {
    // In a production environment, you might want to use a proper prompt
    // For now, we'll automatically continue with a warning
    console.log('⚠️  Continuing with migration - existing status fields will be preserved');
    return true;
  }

  async calculateTotalContacts(listId) {
    try {
      if (!listId) return null;
      
      const listDataCollection = this.database.collection('plivo-list-data');
      const count = await listDataCollection.countDocuments({ listId: listId });
      return count > 0 ? count : null;
    } catch (error) {
      console.error(`Error calculating total contacts for listId ${listId}:`, error);
      return null;
    }
  }

  async performMigration() {
    console.log('\n🚀 Starting campaign schema migration...');
    this.migrationResults.startTime = new Date();

    const campaignCollection = this.database.collection('plivoCampaign');
    
    // Use cursor for memory efficiency with large datasets
    const cursor = campaignCollection.find({});
    
    while (await cursor.hasNext()) {
      const campaign = await cursor.next();
      this.migrationResults.processed++;

      try {
        // Determine if this campaign needs migration
        const needsMigration = !campaign.status || 
                              campaign.currentIndex === undefined ||
                              !campaign.hasOwnProperty('totalContacts') ||
                              campaign.processedContacts === undefined ||
                              !campaign.hasOwnProperty('heartbeat') ||
                              !campaign.hasOwnProperty('lastActivity') ||
                              !campaign.hasOwnProperty('containerId');

        if (!needsMigration) {
          this.migrationResults.skipped++;
          if (this.migrationResults.processed % 50 === 0) {
            console.log(`  📊 Processed ${this.migrationResults.processed} campaigns (${this.migrationResults.skipped} skipped)`);
          }
          continue;
        }

        // Calculate totalContacts if not present
        const totalContacts = campaign.totalContacts !== undefined ? 
                             campaign.totalContacts : 
                             await this.calculateTotalContacts(campaign.listId);

        // Prepare update fields (only add missing fields)
        const updateFields = {};
        
        if (!campaign.status) {
          updateFields.status = 'completed'; // Default to completed for historical campaigns
        }
        
        if (campaign.currentIndex === undefined) {
          updateFields.currentIndex = 0;
        }
        
        if (!campaign.hasOwnProperty('totalContacts')) {
          updateFields.totalContacts = totalContacts;
        }
        
        if (campaign.processedContacts === undefined) {
          updateFields.processedContacts = totalContacts || 0; // Assume completed if no count
        }
        
        if (!campaign.hasOwnProperty('heartbeat')) {
          updateFields.heartbeat = null;
        }
        
        if (!campaign.hasOwnProperty('lastActivity')) {
          updateFields.lastActivity = campaign.createdAt || null;
        }
        
        if (!campaign.hasOwnProperty('containerId')) {
          updateFields.containerId = null;
        }

        // Perform atomic update
        const result = await campaignCollection.updateOne(
          { _id: campaign._id },
          { $set: updateFields }
        );

        if (result.modifiedCount > 0) {
          this.migrationResults.updated++;
        }

        // Progress reporting every 50 campaigns
        if (this.migrationResults.processed % 50 === 0) {
          console.log(`  📊 Processed ${this.migrationResults.processed} campaigns (${this.migrationResults.updated} updated, ${this.migrationResults.skipped} skipped)`);
        }

      } catch (error) {
        console.error(`❌ Error migrating campaign ${campaign._id}:`, error.message);
        this.migrationResults.errors.push({
          campaignId: campaign._id,
          error: error.message
        });
      }
    }

    await cursor.close();
    this.migrationResults.endTime = new Date();
  }

  async validateAfterMigration() {
    console.log('\n🔍 Validating migration results...');
    
    const campaignCollection = this.database.collection('plivoCampaign');
    
    // Count campaigns with each new field
    const requiredFields = ['status', 'currentIndex', 'totalContacts', 'processedContacts', 'heartbeat', 'lastActivity', 'containerId'];
    
    for (const field of requiredFields) {
      const count = await campaignCollection.countDocuments({ 
        [field]: { $exists: true } 
      });
      console.log(`  ✅ Campaigns with ${field}: ${count}`);
    }

    // Sample the migrated data
    const sampleMigrated = await campaignCollection.findOne({ 
      status: { $exists: true } 
    });
    
    if (sampleMigrated) {
      console.log('\n📋 Migrated schema sample:');
      const newFields = requiredFields.filter(field => 
        sampleMigrated.hasOwnProperty(field)
      );
      console.log(`  - New fields: ${newFields.join(', ')}`);
    }
  }

  generateReport() {
    const duration = this.migrationResults.endTime - this.migrationResults.startTime;
    
    console.log('\n📋 CAMPAIGN SCHEMA MIGRATION REPORT');
    console.log('=' .repeat(50));
    console.log(`⏱️  Duration: ${Math.round(duration / 1000)} seconds`);
    console.log(`📊 Total processed: ${this.migrationResults.processed} campaigns`);
    console.log(`✅ Successfully updated: ${this.migrationResults.updated} campaigns`);
    console.log(`⏭️  Skipped (already migrated): ${this.migrationResults.skipped} campaigns`);
    
    if (this.migrationResults.errors.length > 0) {
      console.log(`❌ Errors encountered: ${this.migrationResults.errors.length}`);
      console.log('\nError details:');
      this.migrationResults.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. Campaign ${error.campaignId}: ${error.error}`);
      });
    } else {
      console.log('✅ No errors encountered');
    }

    console.log('\n🎯 Migration Summary:');
    console.log('  - All historical campaigns marked as "completed"');
    console.log('  - Current index set to 0 for progress tracking');  
    console.log('  - Total contacts calculated from list data where possible');
    console.log('  - Processed contacts assumed equal to total for completed campaigns');
    console.log('  - Heartbeat and container fields initialized as null');
    console.log('  - Last activity set to creation date where available');

    return this.migrationResults;
  }

  async createBackup() {
    console.log('\n💾 Creating backup of current data...');
    
    try {
      const campaignCollection = this.database.collection('plivoCampaign');
      const backupCollection = this.database.collection('plivoCampaign_backup_' + Date.now());
      
      // Get all current campaigns
      const campaigns = await campaignCollection.find({}).toArray();
      
      if (campaigns.length > 0) {
        await backupCollection.insertMany(campaigns);
        console.log(`✅ Backup created: ${backupCollection.collectionName} (${campaigns.length} documents)`);
        console.log('   Use this collection to restore if needed');
      }
      
      return backupCollection.collectionName;
    } catch (error) {
      console.error('❌ Failed to create backup:', error);
      throw error;
    }
  }

  async run(createBackup = true) {
    try {
      await this.initialize();
      
      if (createBackup) {
        await this.createBackup();
      }
      
      const shouldProceed = await this.validateBeforeMigration();
      if (!shouldProceed) {
        return null;
      }
      
      await this.performMigration();
      await this.validateAfterMigration();
      
      return this.generateReport();
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    } finally {
      if (client) {
        await client.close();
        console.log('\n🔒 Database connection closed');
      }
    }
  }
}

// Run the migration if this script is called directly
if (require.main === module) {
  const migrator = new CampaignSchemaMigrator();
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const skipBackup = args.includes('--no-backup');
  
  migrator.run(!skipBackup)
    .then((results) => {
      if (results) {
        console.log('\n🎉 Campaign schema migration completed successfully!');
        if (results.errors.length === 0) {
          process.exit(0);
        } else {
          console.log('⚠️  Migration completed with some errors - review the report above');
          process.exit(1);
        }
      }
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { CampaignSchemaMigrator };