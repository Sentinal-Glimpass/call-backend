const { connectToMongo, closeMongoConnection, client } = require('../../../models/mongodb.js');
const axios = require('axios');
const { ObjectId } = require('mongodb'); 
// DEPRECATED: Old billing system removed
// const {updateClientBalanceCount} = require('../exotel/exotel')
const activeCalls = require('../helper/activeCalls.js')

// Import balance broadcasting function
let broadcastBalanceUpdate;
try {
  const billingRouter = require('../../routes/billingRouter');
  broadcastBalanceUpdate = billingRouter.broadcastBalanceUpdate;
} catch (error) {
  console.warn('Balance broadcasting not available:', error.message);
  broadcastBalanceUpdate = null;
}
async function insertList(listName, clientId){
    try {
        await connectToMongo();
    
        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("plivo-list");
            // Insert the list name into the collection

        const existingList = await collection.findOne({ name: listName, clientId: clientId }); 
           if (existingList) {
          return {
            status: 400,
            message: `List name "${listName}" already exists for this client.`,
          };
        }
        const result = await collection.insertOne({ name: listName, createdAt: new Date(), clientId: clientId });

        // Return the inserted document's ID
        return { status: 200, listId: result.insertedId, message: "List inserted successfully." };
      } catch (error) {
        console.error("Error running MongoDB queries:", error);
        return { status: 500, message: "Internal server error." };
      } finally {
       // await closeMongoConnection();
      }
}

async function deleteList(listId) {
    try {
        await connectToMongo();

        const database = client.db("talkGlimpass");
        const collection = database.collection("plivo-list");

        // Delete the list with the given listId and clientId for security
        const result = await collection.deleteOne({ _id: listId});

        if (result.deletedCount === 0) {
          console.log("List not found or not authorized to delete.")
          return 0;
        }

      return 1;
    } catch (error) {
        console.error("Error deleting list:", error);
        return 0;
    } finally {
        // await closeMongoConnection();
    }
}

async function updateList(listId, contactCount) {
  try {
      await connectToMongo();

      const database = client.db("talkGlimpass");
      const collection = database.collection("plivo-list");

      // Update only the contact count for the given listId
      const result = await collection.updateOne(
          { _id: listId },
          { $set: { contactCount: contactCount } }
      );

      if (result.matchedCount === 0) {
          console.log("List not found or not authorized to update.");
          return 0;
      }

      return 1;
  } catch (error) {
      console.error("Error updating list:", error);
      return 0;
  } finally {
      // await closeMongoConnection();
  }
}

async function insertListContent(rows) {
    try {
      await connectToMongo();
  
      const database = client.db("talkGlimpass");
      const collection = database.collection("plivo-list-data");
  
      // Insert all rows into the collection
      const result = await collection.insertMany(rows);
  
      return { status: 200, insertedCount: result.insertedCount, message: "Rows inserted successfully." };
    } catch (error) {
      console.error("Error inserting rows:", error);
      return { status: 500, message: "Internal server error." };
    } finally {
      // Uncomment this if you want to close the connection after each operation
      // await closeMongoConnection();
    }
  }

  async function getListByClientId(clientId) {
    try {
      await connectToMongo();
  
      const database = client.db("talkGlimpass");
      const collection = database.collection("plivo-list");
  
      // Optimized query with sorting and projection for better performance
      const lists = await collection
        .find({ clientId })
        .sort({ createdAt: -1 }) // Sort by createdAt descending (newest first)
        .project({ // Only select needed fields to reduce data transfer
          _id: 1,
          name: 1,
          createdAt: 1,
          clientId: 1,
          contactCount: 1
        })
        .toArray();
  
      return { 
        status: 200, 
        data: lists, // No need to reverse since we're sorting in DB
        message: "Lists fetched successfully." 
      };
      
    } catch (error) {
      console.error("Error fetching lists:", error);
      return { status: 500, message: "Internal server error." };
    } finally {
      // Uncomment this if you want to close the connection after each operation
      // await closeMongoConnection();
    }
  }
  
  async function getContactfromListId(listId) {
    try {
      await connectToMongo();
  
      const database = client.db("talkGlimpass");
      const collection = database.collection("plivo-list-data");
  
      // Find lists associated with the client ID
      const lists = await collection.find({ listId: new ObjectId(listId) }).toArray();
  
      return { status: 200, data: lists, message: "List contacts fetched successfully." };
    } catch (error) {
      console.error("Error fetching list contacts:", error);
      return { status: 500, message: "Internal server error." };
    } finally {
      // Uncomment this if you want to close the connection after each operation
      // await closeMongoConnection();
    }
  }

  async function initiatePlivoCall(from, to, wssUrl, clientId, listDataStringify, uploadedName= '', tag = '', listId = 'incoming', camp_id = 'incoming', email = '') {
    const accountSid = process.env.PLIVO_ACCOUNT_SID;
    const plivoApiUrl = `https://api.plivo.com/v1/Account/${accountSid}/Call/`;

    // Get base URL from environment variable, fallback to default if not set
    const baseUrl = process.env.BASE_URL || 'https://application.glimpass.com';

    const payload = {
      from,
      to,
      ring_url: `${baseUrl}/plivo/ring-url`,
      hangup_url: `${baseUrl}/plivo/hangup-url?campId=${camp_id}&hangupFirstName=${uploadedName}&tag=${tag}`,
      answer_url: `${baseUrl}/ip/xml-plivo?wss=${wssUrl}&clientId=${clientId}&listId=${listId}&campId=${camp_id}&firstName=${uploadedName}&email=${encodeURIComponent(email)}&tag=${encodeURIComponent(tag)}&csvData=${listDataStringify}`,
      answer_method: 'POST',
    };

    console.log(`🔗 Using base URL: ${baseUrl} for Plivo webhooks`);
    console.log(`📞 Ring URL: ${payload.ring_url}`);
    console.log(`📱 Hangup URL: ${payload.hangup_url}`);
    console.log(`💬 Answer URL: ${payload.answer_url}`);
  
    try {
      const response = await axios.post(plivoApiUrl, payload, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${process.env.PLIVO_ACCOUNT_SID}:${process.env.PLIVO_AUTH_TOKEN}`).toString('base64')}`,
          },
      });
      console.log(`status: ${response.status} and call initiated for ${to}`)
      return { status: response.status, data: response.data, message: 'Call initiated successfully.' };
    } catch (error) {
      console.error('Error initiating Plivo call:', error);
      return { status: 500, message: 'Failed to initiate call.' };
    }
  }

  // async function makeCallViaCampaign(listId, fromNumber, wssUrl, campaignName, clientId) {
  //   try {
  //     // Fetch the list data
  //     const listData = await getlistDataById(listId);
  //     const database = client.db("talkGlimpass");
  //     const collection = database.collection("client");
  
  //     // Create the campaign
  //     const result = await createCampaign(campaignName, listId, fromNumber, wssUrl, clientId, false);
  //     if (result === 0) {
  //       return { status: 500, message: 'There is an error while creating the campaign' };
  //     }
  
  //     // Respond immediately with success, then run the loop in the background
  //     process.nextTick(async () => {
  //       try {
  //         const clientResult =  await collection.updateOne(
  //           { _id: new ObjectId(clientId) },
  //           { $set: { isActiveCamp: 1, activeCampId: result } }
  //         );
  //         for (const list of listData) {
  //           await initiatePlivoCall(fromNumber, list.number, wssUrl, clientId, list.first_name, listId, result);
  //           await new Promise(resolve => setTimeout(resolve, 1000)); // Sleep for 1 second
  //           console.log(`Call initiated for ${list.number}`);
  //         }
  //       } catch (loopError) {
  //         console.error("Error in background call scheduling:", loopError);
  //       }
  //     });
  
  //     // Send response immediately without waiting for the loop
  //     return { status: 200, message: 'Call scheduling started in the background' };
  
  //   } catch (error) {
  //     console.error("Error in call scheduling:", error);
  //     return { status: 500, message: 'There is an error in call scheduling' };
  //   }
  // }
  

async function createCampaign(campaignName, listId, fromNumber, wssUrl, clientId, isBalanceUpdated, isCampaignCompleted, provider = null, scheduledTime = null, scheduledBy = null) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");

    // Check if a campaign with the same name already exists for this client
    const existingCampaign = await collection.findOne({ campaignName, clientId });

    if (existingCampaign) {
      return { status: 400, message: `Campaign name '${campaignName}' already exists. Please choose a different name.` };
    }

    // Calculate total contacts from the list
    const listDataCollection = database.collection("plivo-list-data");
    const totalContacts = await listDataCollection.countDocuments({ listId: new ObjectId(listId) });

    // Use current container ID for Cloud Run tracking
    const { CONTAINER_ID } = require('../../utils/containerLifecycle.js');
    const containerId = CONTAINER_ID;

    // Determine status based on scheduling
    const isScheduled = scheduledTime !== null;
    const campaignStatus = isScheduled ? "scheduled" : "running";

    // Build campaign document
    const campaignDoc = {
      // Original fields
      campaignName,
      listId,
      fromNumber,
      wssUrl,
      clientId,
      createdAt: new Date(),
      isBalanceUpdated,
      isCampaignCompleted,

      // Provider-specific routing
      provider: provider,              // Explicit provider (twilio/plivo) or null for auto-detection

      // Enhanced fields for pause/resume functionality
      status: campaignStatus,      // "scheduled", "running", "paused", "completed", "cancelled"
      currentIndex: 0,             // Current position in contact list
      totalContacts: totalContacts, // Total contacts from list
      processedContacts: 0,        // Number of contacts processed

      // Cloud Run heartbeat fields (only for running campaigns)
      heartbeat: isScheduled ? null : new Date(),
      lastActivity: isScheduled ? null : new Date(),
      containerId: isScheduled ? null : containerId,

      // Pause/resume tracking
      pausedAt: null,              // When campaign was paused
      pausedBy: null,              // User who paused campaign
      resumedAt: null              // When campaign was resumed
    };

    // Add scheduling fields if scheduled
    if (isScheduled) {
      campaignDoc.scheduledTime = new Date(scheduledTime);
      campaignDoc.scheduledBy = scheduledBy;
      console.log(`⏰ Campaign scheduled: ${campaignName} for ${campaignDoc.scheduledTime.toISOString()}`);
    }

    // Insert the new campaign
    const result = await collection.insertOne(campaignDoc);

    console.log(`📊 Campaign created: ${campaignName} (${result.insertedId}) - ${totalContacts} contacts - Status: ${campaignStatus}`);
    return result.insertedId.toString();
  } catch (error) {
    console.error("❌ Error creating campaign:", error);
    return 0;
  }
}


async function updateCampaignBalanceStatus(campaignId, isBalanceUpdated) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");

    const campaignObjectId = new ObjectId(campaignId);

    const result = await collection.updateOne(
      { _id: campaignObjectId },
      { $set: { isBalanceUpdated } }
    );

    if (result.matchedCount === 0) {
      return { status: 404, message: "Campaign not found." };
    }

    return { status: 200, message: "Campaign updated successfully." };
  } catch (error) {
    console.error("Error updating campaign:", error);
    return { status: 500, message: "Internal server error." };
  }
}

async function updateCampaignStatus(campaignId, failedCalls, connectedCall, isCampaignCompleted) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");

    const campaignObjectId = new ObjectId(campaignId);

    const result = await collection.updateOne(
      { _id: campaignObjectId },
      { $set: { failedCall: failedCalls, connectedCall: connectedCall, isCampaignCompleted } }
    );

    if (result.matchedCount === 0) {
      return { status: 404, message: "Campaign not found." };
    }

    return { status: 200, message: "Campaign updated successfully." };
  } catch (error) {
    console.error("Error updating campaign:", error);
    return { status: 500, message: "Internal server error." };
  }
}

async function getlistDataById(listId) {
  try{
    await connectToMongo();

    const database = client.db("talkGlimpass");
    const collection = database.collection("plivo-list-data");

    const listData = await collection.find({listId: new ObjectId(listId)}).toArray();

    return listData;

  } catch(error){
    console.log('error fetching list data')
    return [];
  }
}

async function getCampaignByClientId(clientId) {
  try{
    await connectToMongo();
  
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");

    const campaignData = await collection.find({clientId}).toArray();
    const reversedCampaignData = campaignData.reverse();
    if(reversedCampaignData)
      return { status: 200, data: reversedCampaignData, message: "Lists fetched successfully." };
    else
      return { status: 200, data: [], message: "Lists fetched successfully." };

  } catch (error) {
    console.error("Error fetching lists:", error);
    return { status: 500, message: "Internal server error." };
}

}

async function saveRecordData(recordData) {
  try {
    await connectToMongo(); // Ensure MongoDB connection

    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoRecordData");

    // Check if a record with the same CallUUID already exists
    const existingRecord = await collection.findOne({ CallUUID: recordData.CallUUID });

    if (existingRecord) {
      // await handleCallCompletion()
      console.log('Record with this CallUUID already exists.')
      return { status: 409, message: "Record with this CallUUID already exists." }; // Conflict status
    }

    // Insert the new record since no duplicate exists
    await collection.insertOne(recordData);
    console.log("Record saved successfully.")
    return { status: 201, message: "Record saved successfully." }; // Created status
  } catch (error) {
    console.error("Error saving record:", error);
    return { status: 500, message: "Internal server error." };
  }
}

async function saveHangupData(hangupData, options = {}) {
  const { normalize = true, provider = 'plivo', metadata = {} } = options;

  try {
    await connectToMongo();

    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoHangupData");

    // Get callUUID from either format
    const callUUID = hangupData.CallUUID || hangupData.callUUID;

    // IDEMPOTENCY CHECK: Prevent duplicate hangup records for webhook retries
    const existingRecord = await collection.findOne({
      $or: [{ CallUUID: callUUID }, { callUUID: callUUID }]
    });

    if (existingRecord) {
      console.log(`⚠️ Hangup data already exists for CallUUID ${callUUID} - skipping duplicate`);
      return { status: 200, message: "Hangup data already exists.", duplicate: true };
    }

    // Normalize data if requested (new behavior)
    let dataToSave;
    if (normalize) {
      const { normalizePlivoHangup, normalizeTwilioHangup } = require('../helper/callDataNormalizer.js');

      // Build metadata from hangupData fields that were added by the handler
      const fullMetadata = {
        clientId: hangupData.clientId,
        campId: hangupData.campId,
        tag: hangupData.tag,
        assistantId: hangupData.assistantId || hangupData.tag,
        firstName: hangupData.hangupFirstName || hangupData.firstName,
        email: hangupData.email,
        customTag: hangupData.customTag,
        ...metadata
      };

      if (provider === 'twilio') {
        dataToSave = normalizeTwilioHangup(hangupData, fullMetadata);
      } else {
        dataToSave = normalizePlivoHangup(hangupData, fullMetadata);
      }

      // Preserve recording URL if it was added separately
      if (hangupData.RecordUrl && !dataToSave.recordingUrl) {
        dataToSave.recordingUrl = hangupData.RecordUrl;
      }
    } else {
      // Legacy behavior: save raw data as-is
      dataToSave = hangupData;
    }

    // Insert the normalized record
    await collection.insertOne(dataToSave);
    console.log(`✅ Hangup data saved successfully (normalized: ${normalize})`);
    return { status: 201, message: "Hangup data saved successfully." };
  } catch (error) {
    console.error("Error saving hangup data:", error);
    return { status: 500, message: "Internal server error." };
  }
}

// async function handleCallCompletion() {
//     activeCalls.activeCalls.count = Math.max(0, activeCalls.activeCalls.count - 1); // Ensure it never goes below 0
//     console.log(`Call ended, Active calls: ${activeCalls.activeCalls.count}`);
// }

async function getReportByCampId(campId, cursor = null, limit = 100, isDownload = false, filters = null) {
  const campData = await getSingleCampaignDetails(campId)
  
  if(campData.length == 0){
    return { status: 404, message: 'campaign does not exist'}
  }
  
  const failedCall = campData[0].failedCall ?? 0
  const connectedCall = campData[0].connectedCall ?? 0
  const callScheduled = campData[0].isCampaignCompleted
  const hangupDataCount = await getHangupDataCountByCampaignId(campId)
  const listId = campData[0].listId
  const clientId = campData[0].clientId
  const campaignName = campData[0].campaignName
  const isBalanceUpdated = campData[0].isBalanceUpdated
  
  // Get the actual total contacts scheduled for this campaign
  const totalScheduledCalls = campData[0].totalContacts || 0
  
  // Get actual campaign status from database
  const campaignStatus = campData[0].status || 'running'
  
  // Always try to get partial results with pagination and filtering, even if campaign is not completed
  const reportData = await getMergedLogData(campId, cursor, limit, isDownload, filters)
  
  // Calculate campaign duration
  let campDuration = reportData.totalDuration
  if(campDuration){
    campDuration = Math.ceil(campDuration)
  } else{
    campDuration = 0
  }
  
  // PERFORMANCE FIX: Don't run billing calculations on report views
  // Billing should only happen during campaign state transitions, not report generation
  // This was causing 10+ second delays on every report request
  console.log(`📋 Campaign ${campaignName} status: ${campaignStatus}, billing updated: ${isBalanceUpdated}`);
  
  // Skip billing processing during report views - this should be handled by campaign lifecycle events
  // const finalCampaignStates = ['completed', 'cancelled', 'failed'];
  // if(finalCampaignStates.includes(campaignStatus) && !isBalanceUpdated){
  //   // Billing is now handled elsewhere to avoid report view delays
  // }
  
  // Add campaign status to the response
  if (reportData.status === 200) {
    return {
      ...reportData,
      campaignStatus: campaignStatus,
      completedCalls: hangupDataCount,
      totalScheduledCalls: totalScheduledCalls,
      successfulConnections: connectedCall,
      failedCalls: failedCall
    }
  }
  
  // If no hangup data found yet, return empty data with campaign status
  if (reportData.status === 404) {
    return {
      status: 200,
      data: [],
      totalDuration: 0,
      message: "Campaign in progress - no completed calls yet",
      campaignStatus: campaignStatus,
      completedCalls: hangupDataCount,
      totalScheduledCalls: totalScheduledCalls,
      successfulConnections: connectedCall,
      failedCalls: failedCall
    }
  }
  
  return reportData
}

async function getCampaignStatus(campId) {
  try {
  const hangupDataCount = await getHangupDataCountByCampaignId(campId)
  return {status: 200, data: hangupDataCount}
  } catch(error){
    return { status: 500, message: "Internal server error." };
  }

}

async function getHangupDataCountByCampaignId(campId) {
  try {
    await connectToMongo(); // Ensure MongoDB connection
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoHangupData");

    // Count documents where campaignId matches (support both old 'campId' and new 'campaignId' field names)
    const count = await collection.countDocuments({
      $or: [{ campId }, { campaignId: campId }]
    });

    return count;
  } catch (error) {
    console.error("Error getting hangup data count:", error);
    return { status: 500, message: "Internal server error." };
  }
}


// async function getMergedLogData(campId) {
//   try {
//     await connectToMongo(); // Ensure MongoDB connection

//     const database = client.db("talkGlimpass");
//     const logCollection = database.collection("logData");
//     const recordCollection = database.collection("plivoRecordData");

//     // Fetch all logData documents based on listId
//     const logDataDocs = await logCollection.find({ campId }).toArray();

//     if (logDataDocs.length === 0) {
//       return { status: 404, message: "No log data found for the given campId." };
//     }

//     // Calculate total conversation time
//     const totalConversationTime = logDataDocs.reduce((sum, doc) => sum + (doc.conversation_time || 0), 0);

//     // Extract unique CallUUIDs from logData documents
//     const callUUIDs = logDataDocs.map(doc =>{ return doc.callUUID});
//     // Fetch corresponding records from plivoRecordData
//     const recordDataDocs = await recordCollection
//       .find({ CallUUID: { $in: callUUIDs } })
//       .toArray();

//     // Convert recordDataDocs to a Map for fast lookup
//     const recordMap = new Map(
//       recordDataDocs.map(record => [record.CallUUID, record.RecordUrl])
//     );


//     const mergedData = logDataDocs.map(doc => {  
//       return {
//         ...doc,
//         RecordUrl: recordMap.get(doc.callUUID) || null, // Attach RecordUrl if found
//       };
//     });
    


//     return { 
//       status: 200, 
//       data: mergedData, 
//       totalDuration: totalConversationTime, 
//       message: "Merged data fetched successfully." 
//     };
//   } catch (error) {
//     console.error("Error fetching merged log data:", error);
//     return { status: 500, message: "Internal server error." };
//   }
// }

async function getMergedLogData(campId, cursor = null, limit = 100, isDownload = false, filters = null) {
  try {
    await connectToMongo(); // Ensure MongoDB connection

    const database = client.db("talkGlimpass");
    const hangupCollection = database.collection("plivoHangupData");
    const logCollection = database.collection("logData");
    const recordCollection = database.collection("plivoRecordData");

    // Build query with cursor for pagination and filtering
    // Support both old 'campId' and new 'campaignId' field names
    const query = { $or: [{ campId }, { campaignId: campId }] };
    
    // Apply filters if provided
    if (filters) {
      console.log(`🔍 Applying filters to campaign ${campId}:`, filters);
      
      // Duration filtering - convert Duration field to integer for comparison
      if (filters.duration) {
        const durationQuery = {};
        
        if (filters.duration.min !== undefined) {
          durationQuery.$gte = parseInt(filters.duration.min);
        }
        
        if (filters.duration.max !== undefined) {
          durationQuery.$lte = parseInt(filters.duration.max);
        }
        
        if (filters.duration.equals !== undefined) {
          durationQuery.$eq = parseInt(filters.duration.equals);
        }
        
        if (Object.keys(durationQuery).length > 0) {
          // Convert Duration string to integer for comparison
          query.$expr = {
            $and: [
              ...(query.$expr?.$and || []),
              ...Object.entries(durationQuery).map(([operator, value]) => ({
                [operator]: [{ $toInt: { $ifNull: ["$Duration", "0"] } }, value]
              }))
            ]
          };
          console.log(`⏱️ Duration filter applied:`, durationQuery);
        }
      }
      
      // Multiple custom filters support (array of custom filters)
      if (filters.customFilters && Array.isArray(filters.customFilters)) {
        console.log(`🔧 Processing ${filters.customFilters.length} custom filters`);
        
        // Collect all custom filter conditions
        const customFilterConditions = [];
        
        filters.customFilters.forEach((customFilter, index) => {
          if (!customFilter.field || !customFilter.value) {
            console.warn(`⚠️ Skipping invalid custom filter ${index}: missing field or value`);
            return;
          }
          
          let fieldName = customFilter.field;
          const searchValue = customFilter.value;
          const operator = customFilter.operator || 'contains'; // default to contains
          
          // Use field name as-is - no conversion needed
          console.log(`🔧 Filter ${index}: Using field name as-is: ${fieldName}`);
          
          let filterCondition = null;
          
          if (operator === 'contains') {
            // Simple string search with case insensitive regex - no boolean logic
            filterCondition = {
              [fieldName]: { 
                $regex: searchValue, 
                $options: 'i' // case insensitive
              }
            };
            console.log(`🔧 Filter ${index}: ${fieldName} contains "${searchValue}" (case insensitive)`);
          } else if (operator === 'not_contains') {
            // Simple string negation with case insensitive regex
            filterCondition = {
              [fieldName]: { 
                $not: { 
                  $regex: searchValue, 
                  $options: 'i' 
                }
              }
            };
            console.log(`🔧 Filter ${index}: ${fieldName} does not contain "${searchValue}" (case insensitive)`);
          } else if (operator === 'not_equals') {
            // Exact value negation (case insensitive)
            filterCondition = {
              [fieldName]: { 
                $not: { 
                  $regex: `^${searchValue}$`, 
                  $options: 'i' 
                }
              }
            };
            console.log(`🔧 Filter ${index}: ${fieldName} does not equal "${searchValue}" (case insensitive)`);
          } else if (operator === 'equals') {
            // Exact value match (case insensitive)
            filterCondition = {
              [fieldName]: { 
                $regex: `^${searchValue}$`, 
                $options: 'i' 
              }
            };
            console.log(`🔧 Filter ${index}: ${fieldName} equals "${searchValue}" (case insensitive)`);
          }
          
          if (filterCondition) {
            customFilterConditions.push(filterCondition);
          }
        });
        
        // Apply all custom filters using $and
        if (customFilterConditions.length > 0) {
          // Ensure we have a proper $and array structure
          if (!query.$and) {
            query.$and = [];
          }
          
          // Add existing non-$and conditions to $and array
          const existingConditions = Object.keys(query)
            .filter(k => k !== '$and' && k !== '$expr')
            .map(k => ({ [k]: query[k] }));
          
          if (existingConditions.length > 0) {
            query.$and.push(...existingConditions);
            // Remove the old conditions from the main query
            existingConditions.forEach(condition => {
              Object.keys(condition).forEach(k => delete query[k]);
            });
          }
          
          // Add all custom filter conditions
          query.$and.push(...customFilterConditions);
          
          console.log(`✅ Applied ${customFilterConditions.length} custom filters`);
        }
      }
      
      // Legacy single custom filter support (for backward compatibility)
      else if (filters.custom && filters.custom.field && filters.custom.value) {
        console.log(`🔧 Processing legacy single custom filter`);
        
        let fieldName = filters.custom.field;
        const searchValue = filters.custom.value;
        const operator = filters.custom.operator || 'contains'; // default to contains
        
        // Use field name as-is - no conversion needed
        console.log(`🔧 Legacy filter: Using field name as-is: ${fieldName}`);
        
        if (operator === 'contains') {
          // Simple string search with case insensitive regex - no boolean logic
          query[fieldName] = { 
            $regex: searchValue, 
            $options: 'i' // case insensitive
          };
          console.log(`🔧 Legacy custom filter applied - ${fieldName} contains "${searchValue}" (case insensitive)`);
        } else if (operator === 'not_contains') {
          // Simple string negation with case insensitive regex
          query[fieldName] = { 
            $not: { 
              $regex: searchValue, 
              $options: 'i' 
            }
          };
          console.log(`🔧 Legacy custom filter applied - ${fieldName} does not contain "${searchValue}" (case insensitive)`);
        } else if (operator === 'not_equals') {
          // Exact value negation (case insensitive)
          query[fieldName] = { 
            $not: { 
              $regex: `^${searchValue}$`, 
              $options: 'i' 
            }
          };
          console.log(`🔧 Legacy custom filter applied - ${fieldName} does not equal "${searchValue}" (case insensitive)`);
        } else if (operator === 'equals') {
          // Exact value match (case insensitive)
          query[fieldName] = { 
            $regex: `^${searchValue}$`, 
            $options: 'i' 
          };
          console.log(`🔧 Legacy custom filter applied - ${fieldName} equals "${searchValue}" (case insensitive)`);
        }
      }
    }
    
    // PERFORMANCE OPTIMIZATION: Skip expensive count/duration aggregation for large datasets
    // Only calculate totals for first page AND when dataset is reasonably small
    let totalCount = null;
    let totalDuration = null;
    
    // Skip total calculations for cursor-based pagination (except download mode)
    if ((!cursor || isDownload) && !filters?.skipTotals) {
      const countQuery = { ...query };
      
      try {
        // Use a faster estimate for very large datasets
        const estimatedCount = await hangupCollection.estimatedDocumentCount();
        
        // If the entire collection is huge (>100k), skip expensive aggregation 
        // unless this is a download request or explicit filter request
        if (estimatedCount > 100000 && !isDownload && (!filters || Object.keys(filters).length === 0)) {
          console.log(`⚡ Skipping expensive aggregation for large dataset (estimated: ${estimatedCount} docs)`);
          totalCount = null; // Will be calculated on client-side or estimated
          totalDuration = null;
        } else {
          // Use aggregation pipeline with performance optimizations
          const aggregationPipeline = [
            { $match: countQuery },
            {
              $group: {
                _id: null,
                totalCount: { $sum: 1 },
                totalDuration: { 
                  $sum: { 
                    $convert: { 
                      input: "$Duration", 
                      to: "int", 
                      onError: 0, 
                      onNull: 0 
                    } 
                  } 
                }
              }
            }
          ];
          
          // Add timeout and hint for better performance
          const aggregationOptions = { 
            maxTimeMS: 5000, // 5 second timeout
            allowDiskUse: true 
          };
          
          const aggregationResult = await hangupCollection
            .aggregate(aggregationPipeline, aggregationOptions)
            .toArray();
          
          if (aggregationResult.length > 0) {
            totalCount = aggregationResult[0].totalCount;
            totalDuration = aggregationResult[0].totalDuration;
          } else {
            totalCount = 0;
            totalDuration = 0;
          }
        }
      } catch (aggregationError) {
        console.warn(`⚠️ Aggregation timeout or error, falling back to page-based calculation:`, aggregationError.message);
        totalCount = null;
        totalDuration = null;
      }
    }

    if (cursor && !isDownload) {
      // Cursor is the _id of the last item from previous page (only for pagination mode)
      query._id = { $lt: new ObjectId(cursor) };
    }

    // For download mode, ignore pagination limits
    const queryLimit = isDownload ? 0 : limit + 1; // 0 means no limit in MongoDB

    // PERFORMANCE OPTIMIZATION: Fetch hangup data with better query planning
    let hangupQuery = hangupCollection
      .find(query)
      .sort({ _id: -1 });
      
    // Add query hints to use the right index
    if (Object.keys(query).length > 1) {
      hangupQuery = hangupQuery.hint({ campId: 1, _id: -1 });
    }
      
    if (queryLimit > 0) {
      hangupQuery = hangupQuery.limit(queryLimit);
    }

    // Add timeout to prevent long-running queries
    hangupQuery = hangupQuery.maxTimeMS(25000); // 25 second timeout

    const hangupDataDocs = await hangupQuery.toArray();

    if (hangupDataDocs.length === 0) {
      return { 
        status: 404, 
        message: "No hangup data found for the given campId.",
        data: [],
        totalCount: totalCount || 0,
        totalDuration: totalDuration || 0,
        hasNextPage: false,
        nextCursor: null,
        pagination: {
          currentPage: cursor ? 'N/A' : 1,
          hasNextPage: false,
          nextCursor: null,
          totalRecords: totalCount || 0
        },
        isDownload
      };
    }

    // For download mode, no pagination logic
    let hasNextPage = false;
    let nextCursor = null;
    
    if (!isDownload) {
      // Check if there's a next page (only in pagination mode)
      hasNextPage = hangupDataDocs.length > limit;
      if (hasNextPage) {
        hangupDataDocs.pop(); // Remove the extra item
      }
      
      // Get the next cursor (last item's _id)
      nextCursor = hasNextPage ? hangupDataDocs[hangupDataDocs.length - 1]._id.toString() : null;
    }

    // Extract unique CallUUIDs from hangupData (support both old 'CallUUID' and new 'callUUID' field names)
    const callUUIDs = hangupDataDocs.map(doc => doc.CallUUID || doc.callUUID).filter(Boolean);

    // PERFORMANCE OPTIMIZATION: Parallel fetch of related data with timeouts
    const [logDataDocs, recordDataDocs] = await Promise.allSettled([
      logCollection
        .find({ callUUID: { $in: callUUIDs } })
        .maxTimeMS(10000) // 10 second timeout
        .toArray(),
      recordCollection
        .find({ CallUUID: { $in: callUUIDs } })
        .maxTimeMS(5000) // 5 second timeout
        .toArray()
    ]).then(results => [
      results[0].status === 'fulfilled' ? results[0].value : [],
      results[1].status === 'fulfilled' ? results[1].value : []
    ]);

    // Handle failed queries gracefully
    if (logDataDocs.length === 0) {
      console.warn(`⚠️ No logData found for ${callUUIDs.length} CallUUIDs in campaign ${campId}`);
    }

    // Calculate duration for this page
    const pageDuration = hangupDataDocs.reduce((sum, doc) => sum + (parseInt(doc.duration || doc.Duration) || 0), 0);

    // Group log data by CallUUID and get the latest entry using ObjectId
    const latestLogDataMap = new Map();
    logDataDocs.forEach(doc => {
      const existingDoc = latestLogDataMap.get(doc.callUUID);
      if (!existingDoc || doc._id > existingDoc._id) {
        latestLogDataMap.set(doc.callUUID, doc);
      }
    });

    // Convert recordDataDocs to a Map for fast lookup
    const recordMap = new Map(recordDataDocs.map(record => [record.CallUUID, record.RecordUrl]));

    // Merge logData and record URLs into hangupData
    const mergedData = hangupDataDocs.map(hangupDoc => {
      // Support both old 'CallUUID' and new 'callUUID' field names
      const docCallUUID = hangupDoc.CallUUID || hangupDoc.callUUID;
      const logData = latestLogDataMap.get(docCallUUID) || {};
      return {
        ...hangupDoc,
        ...logData, // Merge latest log data
        // CRITICAL: Preserve RecordUrl from hangup data (Twilio), fallback to record collection (Plivo)
        RecordUrl: hangupDoc.RecordUrl || hangupDoc.recordingUrl || recordMap.get(docCallUUID) || null,
      };
    });

    return { 
      status: 200, 
      data: mergedData, 
      totalDuration: totalDuration !== null ? totalDuration : pageDuration, // Use total if available, otherwise page duration
      message: "Merged data fetched successfully.",
      totalCount: totalCount || hangupDataDocs.length,
      hasNextPage: hasNextPage,
      nextCursor: nextCursor,
      pagination: {
        currentPage: cursor ? 'N/A' : 1, // Page numbers not applicable with cursor pagination
        hasNextPage: hasNextPage,
        nextCursor: nextCursor,
        totalRecords: totalCount || hangupDataDocs.length,
        limit: isDownload ? 'All' : limit
      },
      isDownload: isDownload
    };
  } catch (error) {
    console.error("Error fetching merged log data:", error);
    return { status: 500, message: "Internal server error." };
  }
}

async function getIncomingReport(fromNumber, cursor = null, limit = 20, dateRange = null, isDownload = false){
  try{
    await connectToMongo(); // Ensure MongoDB connection

    const database = client.db("talkGlimpass");
    const hangupCollection = database.collection("plivoHangupData");
    const logCollection = database.collection("logData");
    const recordCollection = database.collection("plivoRecordData");

    // Build query with cursor for pagination and date filtering
    const query = { To: fromNumber, campId: 'incoming' };
    
    // First, let's check what documents exist without date filtering
    console.log(`🔍 Checking base query: ${JSON.stringify(query)}`);
    const baseCount = await hangupCollection.countDocuments(query);
    console.log(`📊 Base query found ${baseCount} total documents`);
    
    // Get a sample document to see the actual structure
    const sampleDoc = await hangupCollection.findOne(query);
    if (sampleDoc) {
      console.log('📝 Sample document structure:', {
        _id: sampleDoc._id,
        CallUUID: sampleDoc.CallUUID,
        To: sampleDoc.To,
        campId: sampleDoc.campId,
        StartTime: sampleDoc.StartTime,
        allFields: Object.keys(sampleDoc)
      });
    } else {
      console.log('❌ No documents found with base query');
    }
    
    // Add date range filtering if provided - using StartTime field
    if (dateRange && (dateRange.startDate || dateRange.endDate)) {
      const dateQuery = {};
      
      // Ensure we have the correct date order (earlier date as $gte, later date as $lte)
      const startDateObj = dateRange.startDate ? new Date(dateRange.startDate) : null;
      const endDateObj = dateRange.endDate ? new Date(dateRange.endDate) : null;
      
      let earlierDate, laterDate;
      
      if (startDateObj && endDateObj) {
        // Both dates provided - use the earlier as $gte, later as $lte
        if (startDateObj <= endDateObj) {
          earlierDate = dateRange.startDate;
          laterDate = dateRange.endDate;
        } else {
          earlierDate = dateRange.endDate;
          laterDate = dateRange.startDate;
        }
      } else {
        // Only one date provided
        earlierDate = dateRange.startDate;
        laterDate = dateRange.endDate;
      }
      
      if (earlierDate) {
        // StartTime format: "2025-03-12 13:31:10"
        const startOfDay = `${earlierDate} 00:00:00`;
        dateQuery.$gte = startOfDay;
        console.log(`📅 Setting $gte to: ${startOfDay}`);
      }
      
      if (laterDate) {
        const endOfDay = `${laterDate} 23:59:59`;
        dateQuery.$lte = endOfDay;
        console.log(`📅 Setting $lte to: ${endOfDay}`);
      }
      
      // Use StartTime field for date filtering (string comparison works with YYYY-MM-DD HH:mm:ss format)
      query.StartTime = dateQuery;
      console.log('📅 Date filtering applied:', { 
        StartTime: dateQuery, 
        dateRange,
        fullQuery: query 
      });
      
      // Check how many documents match with date filtering
      const dateFilteredCount = await hangupCollection.countDocuments(query);
      console.log(`📊 After date filtering: ${dateFilteredCount} documents match (was ${baseCount} before)`);
      
      // If no results, let's try a broader query to see what StartTime values exist
      if (dateFilteredCount === 0) {
        console.log('🔍 Investigating StartTime values...');
        const startTimeSamples = await hangupCollection.find(
          { To: fromNumber, campId: 'incoming' },
          { projection: { StartTime: 1, CallUUID: 1 } }
        ).limit(10).toArray();
        
        console.log('📝 StartTime samples from DB:', startTimeSamples.map(doc => ({
          CallUUID: doc.CallUUID,
          StartTime: doc.StartTime,
          StartTimeType: typeof doc.StartTime
        })));
      }
    }
    
    // Get total count of matching records ONLY on first page (no cursor) or download mode
    let totalCount = null;
    if (!cursor || isDownload) {
      const countQuery = { ...query };
      totalCount = await hangupCollection.countDocuments(countQuery);
    }
    
    if (cursor && !isDownload) {
      // Cursor is the _id of the last item from previous page (only for pagination mode)
      query._id = { $lt: new ObjectId(cursor) };
    }
    
    // For download mode, ignore pagination limits
    const queryLimit = isDownload ? 0 : limit + 1; // 0 means no limit in MongoDB
    
    // Fetch hangup data with pagination (sorted by _id desc for newest first)
    let hangupQuery = hangupCollection
      .find(query)
      .sort({ _id: -1 });
      
    if (queryLimit > 0) {
      hangupQuery = hangupQuery.limit(queryLimit);
    }
    
    const hangupDataDocs = await hangupQuery.toArray();
    
    console.log(`🔍 Query executed: Found ${hangupDataDocs.length} hangup records`);
    if (hangupDataDocs.length > 0) {
      console.log('📝 Sample StartTime values:', hangupDataDocs.slice(0, 3).map(doc => ({
        CallUUID: doc.CallUUID,
        StartTime: doc.StartTime
      })));
    }

    
    if (hangupDataDocs.length === 0) {
      return { 
        status: 404, 
        message: dateRange ? "No hangup data found for the given Number in the specified date range." : "No hangup data found for the given Number.",
        data: [],
        hasNextPage: false,
        nextCursor: null,
        totalCount: totalCount || 0, // Show 0 for 404 responses
        isDownload
      };
    }

    // For download mode, no pagination logic
    let hasNextPage = false;
    let nextCursor = null;
    
    if (!isDownload) {
      // Check if there's a next page (only in pagination mode)
      hasNextPage = hangupDataDocs.length > limit;
      if (hasNextPage) {
        hangupDataDocs.pop(); // Remove the extra item
      }
      
      // Get the next cursor (last item's _id)
      nextCursor = hasNextPage ? hangupDataDocs[hangupDataDocs.length - 1]._id.toString() : null;
    }

    // Extract unique CallUUIDs from hangupData
    const callUUIDs = hangupDataDocs.map(doc =>{ return doc.CallUUID });

    // Fetch all logData documents based on CallUUIDs
    const logDataDocs = await logCollection.find({ callUUID: { $in: callUUIDs } }).toArray();

    // Group log data by CallUUID and get the latest entry using ObjectId
    const latestLogDataMap = new Map();
    logDataDocs.forEach(doc => {
      const existingDoc = latestLogDataMap.get(doc.callUUID);
      if (!existingDoc || doc._id > existingDoc._id) {
        latestLogDataMap.set(doc.callUUID, doc);
      }
    });

    // Fetch corresponding records from plivoRecordData
    const recordDataDocs = await recordCollection.find({ CallUUID: { $in: callUUIDs } }).toArray();

    // Convert recordDataDocs to a Map for fast lookup
    const recordMap = new Map(recordDataDocs.map(record => [record.CallUUID, record.RecordUrl]));

    // Merge logData and record URLs into hangupData
    const mergedData = hangupDataDocs.map(hangupDoc => {
      // Support both old 'CallUUID' and new 'callUUID' field names
      const docCallUUID = hangupDoc.CallUUID || hangupDoc.callUUID;
      const logData = latestLogDataMap.get(docCallUUID) || {};
      return {
        ...hangupDoc,
        ...logData, // Merge latest log data
        // CRITICAL: Preserve RecordUrl from hangup data (Twilio), fallback to record collection (Plivo)
        RecordUrl: hangupDoc.RecordUrl || hangupDoc.recordingUrl || recordMap.get(docCallUUID) || null,
      };
    });

    const responseMessage = isDownload 
      ? `Download data fetched successfully. Retrieved: ${mergedData.length}${totalCount !== null ? `, Total available: ${totalCount}` : ''}`
      : totalCount !== null 
        ? `Merged data fetched successfully. Page: ${mergedData.length}, Total available: ${totalCount}`
        : `Merged data fetched successfully. Page: ${mergedData.length}`;

    return { 
      status: 200, 
      data: mergedData, 
      message: responseMessage,
      hasNextPage,
      nextCursor,
      totalItems: mergedData.length,
      totalCount,
      isDownload,
      dateRange
    };
  } catch(error){
    console.error("Error in getIncomingReport:", error);
    return { 
      status: 500, 
      message: "Internal server error",
      data: [],
      hasNextPage: false,
      nextCursor: null,
      totalItems: 0,
      totalCount: 0,
      isDownload: isDownload || false
    };
  }
}




async function getSingleCampaignDetails(camp_id) {
  try{
    await connectToMongo();
  
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");

    const campaignData = await collection.find({_id: new ObjectId(camp_id)}).toArray();

    return campaignData;
  } catch (error) {
    console.error("Error fetching lists:", error);
    return [];
  }
}


async function makeCallViaCampaign(listId, fromNumber, wssUrl, campaignName, clientId, provider = null, scheduledTime = null, scheduledBy = null) {
  try {
      const listData = await getlistDataById(listId);
      const contactCount = listData.length;

      // Estimate campaign cost (average 30 seconds per call)
      const estimatedSecondsPerCall = parseInt(process.env.ESTIMATED_CALL_DURATION) || 30;
      const estimatedCost = contactCount * estimatedSecondsPerCall; // 1 second = 1 credit

      console.log(`💰 Campaign cost estimation: ${contactCount} contacts × ${estimatedSecondsPerCall}s = ${estimatedCost} credits`);

      // Validate client balance before creating campaign
      const balanceCheck = await validateClientBalance(clientId, estimatedCost);

      if (!balanceCheck.canStart) {
          console.log(`❌ Campaign blocked: ${balanceCheck.message}`);
          return {
              status: 400,
              message: balanceCheck.message,
              balance: balanceCheck.balance,
              estimatedCost: estimatedCost,
              contactCount: contactCount
          };
      }

      if (!balanceCheck.canAfford) {
          console.log(`⚠️ Campaign warning: ${balanceCheck.message}`);
          // Allow campaign to start but warn about insufficient funds
          console.log(`📊 Campaign will proceed but may pause when balance exhausts`);
      } else {
          console.log(`✅ Balance validation passed: ${balanceCheck.balance} credits available for ${estimatedCost} estimated cost`);
      }

      // Check if this is a scheduled campaign
      const isScheduled = scheduledTime !== null;

      const result = await createCampaign(campaignName, listId, fromNumber, wssUrl, clientId, false, false, provider, scheduledTime, scheduledBy);
      if (result === 0) {
          return { status: 500, message: 'Error while creating the campaign' };
      }

      // Handle new error response format
      if (result && typeof result === 'object' && result.status) {
          return result;
      }

      // If scheduled, don't start the campaign - scheduler will handle it
      if (isScheduled) {
          console.log(`⏰ Campaign scheduled successfully: ${campaignName} (${result}) for ${new Date(scheduledTime).toISOString()}`);
          return {
              status: 200,
              message: `Campaign scheduled successfully for ${new Date(scheduledTime).toISOString()}`,
              campaignId: result,
              scheduledTime: scheduledTime
          };
      }

      const database = client.db("talkGlimpass");
      const collection = database.collection("client");

      // Update client active campaign status
      const clientResult = await collection.updateOne(
        { _id: new ObjectId(clientId) },
        { $set: { isActiveCamp: 1, activeCampId: result } }
      );

      // Start enhanced campaign processing with pause/resume awareness
      console.log(`🚀 Starting enhanced campaign processing: ${campaignName} (${result})`);
      process.nextTick(() => processEnhancedCampaign(result, listData, fromNumber, wssUrl, clientId, listId, provider));
      
      return { status: 200, message: 'Enhanced campaign processing started', campaignId: result };
  } catch (error) {
      console.error("❌ Error in enhanced call scheduling:", error);
      return { status: 500, message: 'Error in enhanced call scheduling' };
  }
}

async function retryCampaign(campId){
  try{
    const campDetails = await getSingleCampaignDetails(campId)
    const failedCalls = await getFailedCallsFromCampaign(campId)
    process.nextTick(() => initiateCalls(failedCalls, campDetails[0].fromNumber, campDetails[0].wssUrl, campDetails[0].clientId, campDetails[0].listId, campId));
    // console.log(campDetails, failedCalls)
    return { status: 200, message: 'Call retry started in the background' };
  } catch(error){
    console.error("Error in call retry:", error);
    return { status: 500, message: 'Error in call retry' };
  }
}

async function getFailedCallsFromCampaign(campId) {
  try {
    await connectToMongo(); // Ensure MongoDB connection

    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoHangupData");

    const pendingCalls = await collection
      .find({
        // Support both old 'campId' and new 'campaignId' field names
        $or: [{ campId: campId }, { campaignId: campId }],
        // Support both old 'CallStatus' and new 'status' field names
        $and: [
          { $or: [{ CallStatus: { $ne: "completed" } }, { status: { $ne: "completed" } }] }
        ]
      })
      .toArray();

    // Add first_name and number fields while keeping all original fields
    return pendingCalls.map(doc => ({
      ...doc,
      first_name: doc.hangupFirstName,
      number: doc.To
    }));
  } catch (error) {
    console.error("Error fetching pending calls:", error);
    return [];
  }
}


// Enhanced campaign processing with pause/resume awareness and heartbeat management
async function processEnhancedCampaign(campaignId, listData, fromNumber, wssUrl, clientId, listId, provider = null) {
  let heartbeatActive = false;
  
  try {
    console.log(`🚀 Starting enhanced campaign: ${campaignId} with ${listData.length} contacts`);
    
    // Start heartbeat timer for container health monitoring
    const heartbeatResult = await startHeartbeat(campaignId);
    heartbeatActive = heartbeatResult.success;
    
    // Multi-pod warmup: Warm up N pods where N = client's maxConcurrentCalls
    const { warmupMultiplePods } = require('../../utils/botWarmup.js');
    const { connectToMongo, client } = require('../../../models/mongodb.js');
    const { ObjectId } = require('mongodb');
    
    let multiPodWarmupResult = { success: true, successCount: 0, totalPods: 0 };
    const warmupEnabled = process.env.BOT_WARMUP_ENABLED !== 'false';
    
    if (warmupEnabled && wssUrl) {
      try {
        // Get client's concurrency limit to determine how many pods to warm up
        await connectToMongo();
        const database = client.db("talkGlimpass");
        const clientCollection = database.collection("client");
        const clientData = await clientCollection.findOne(
          { _id: new ObjectId(clientId) },
          { projection: { maxConcurrentCalls: 1 } }
        );
        
        const maxConcurrentCalls = clientData?.maxConcurrentCalls || parseInt(process.env.DEFAULT_CLIENT_MAX_CONCURRENT_CALLS) || 10;
        
        // Extract bot's base URL from WebSocket URL and create warmup endpoint
        let botWarmupUrl;
        try {
          const wsUrl = new URL(wssUrl);
          const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
          botWarmupUrl = `${protocol}//${wsUrl.host}/warmup`;
          console.log(`🔗 Bot warmup URL extracted from campaign wssUrl: ${botWarmupUrl}`);
        } catch (error) {
          console.error('❌ Failed to extract bot URL from campaign wssUrl:', wssUrl, error.message);
          botWarmupUrl = null;
        }
        
        if (botWarmupUrl) {
          console.log(`🔥 Starting multi-pod warmup for campaign: ${maxConcurrentCalls} pods...`);
          multiPodWarmupResult = await warmupMultiplePods(botWarmupUrl, maxConcurrentCalls);
          
          if (multiPodWarmupResult.success) {
            console.log(`✅ Campaign multi-pod warmup completed: ${multiPodWarmupResult.successCount}/${multiPodWarmupResult.totalPods} pods ready (${multiPodWarmupResult.duration}ms)`);
          } else {
            console.error(`❌ Campaign multi-pod warmup failed: ${multiPodWarmupResult.error}`);
            // Continue with campaign even if warmup fails
          }
        }
      } catch (warmupError) {
        console.error('❌ Error during campaign multi-pod warmup:', warmupError.message);
        // Continue with campaign even if warmup fails
      }
    }
    
    // Import the unified call processing system
    const { processSingleCall } = require('../helper/activeCalls.js');
    
    let callsInLastMinute = 0;
    let failedCall = 0;
    let connectedCall = 0;
    let rateLimitStartTime = Date.now();
    
    // Get campaign state to determine starting position
    let campaignState = await getCampaignState(campaignId);
    if (!campaignState) {
      console.error(`❌ Campaign state not found: ${campaignId}`);
      return;
    }
    
    // Process contacts starting from saved position
    for (let i = campaignState.currentIndex; i < listData.length; i++) {
      // CRITICAL: Check campaign status before each call
      campaignState = await getCampaignState(campaignId);
      
      if (campaignState.status === "paused") {
        console.log(`⏸️ Campaign paused at index ${i}: ${campaignId}`);
        // Update current position where we paused
        await updateCampaignProgress(campaignId, i);
        break;
      }
      
      if (campaignState.status === "cancelled") {
        console.log(`🛑 Campaign cancelled at index ${i}: ${campaignId}`);
        await updateCampaignProgress(campaignId, i);
        break;
      }
      
      if (campaignState.status !== "running") {
        console.log(`⚠️ Campaign status changed to ${campaignState.status}: ${campaignId}`);
        await updateCampaignProgress(campaignId, i);
        break;
      }
      
      // BALANCE CHECK: Pause campaign if balance falls to zero or below
      const balanceResult = await getCurrentClientBalance(clientId);
      if (balanceResult.success && balanceResult.balance <= 0) {
        console.log(`💰 Balance insufficient (${balanceResult.balance} credits) - pausing campaign at contact ${i + 1}/${listData.length}`);
        
        // Pause the campaign due to insufficient balance
        const pauseResult = await pauseCampaign(campaignId);
        if (pauseResult.success) {
          console.log(`⏸️ Campaign auto-paused due to insufficient balance: ${campaignId}`);
          
          // Update campaign with pause reason
          await updateCampaignPauseReason(campaignId, 'insufficient_balance', balanceResult.balance);
          
          // Update current position where we paused
          await updateCampaignProgress(campaignId, i);
          break;
        } else {
          console.error(`❌ Failed to auto-pause campaign: ${pauseResult.error}`);
          // Continue but log the issue
        }
      } else if (balanceResult.success) {
        console.log(`💰 Balance check passed: ${balanceResult.balance} credits available`);
      }
      
      const contact = listData[i];

      // DEBUG: Log contact data to verify email is present
      console.log(`📋 [Campaign] Contact ${i + 1}:`, {
        number: contact.number,
        first_name: contact.first_name,
        email: contact.email,
        allFields: Object.keys(contact)
      });

      // Rate limiting logic
      const maxCallsPerMinute = parseInt(process.env.MAX_CALLS_PER_MINUTE) || 10;
      if (callsInLastMinute >= maxCallsPerMinute) {
        const elapsedTime = Date.now() - rateLimitStartTime;
        const rateLimitWindow = parseInt(process.env.RATE_LIMIT_WINDOW) || 60000;
        
        if (elapsedTime < rateLimitWindow) {
          const waitTime = rateLimitWindow - elapsedTime;
          console.log(`⏳ Rate limit: waiting ${waitTime / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        callsInLastMinute = 0;
        rateLimitStartTime = Date.now();
      }
      
      // Extract assistantId from wssUrl for NEW billing system two-step lookup
      // Pattern: wss://live.glimpass.com/chat/v2/{assistantId}
      let assistantId = '';
      try {
        const urlParts = wssUrl.split('/');
        assistantId = urlParts[urlParts.length - 1]; // Last part should be assistantId
        console.log(`🎯 Campaign call - extracted assistantId: ${assistantId} from wssUrl`);
      } catch (error) {
        console.warn(`⚠️ Could not extract assistantId from wssUrl: ${wssUrl}`);
        assistantId = contact.tag ?? ''; // Fallback to contact tag
      }

      // Process single call using unified system with assistantId as tag for billing
      // Pass full contact object to support dynamic CSV columns
      const callResult = await processSingleCall({
        clientId,
        campaignId,
        from: fromNumber,
        to: contact.number,
        wssUrl,
        // Pass individual fields for backward compatibility
        firstName: contact.first_name || '',
        email: contact.email || '',
        tag: assistantId, // Use assistantId for NEW billing system
        listId,
        provider: provider, // Pass explicit provider for campaign-wide provider selection
        // Enhanced tracking for pause/resume
        contactIndex: i,                           // Position in list
        sequenceNumber: i + 1,                     // Sequence number (1-based)
        contactData: contact,                      // Full contact data with ALL CSV columns
        // Pass all dynamic fields from CSV
        dynamicFields: contact                     // All CSV fields for dynamic header generation
      });
      
      // Track results and update campaign statistics
      if (callResult.success) {
        connectedCall++;
        console.log(`✅ Call ${i + 1}/${listData.length}: ${contact.number} (${callResult.callUUID})`);
        
        // Update campaign position after successful processing
        await updateCampaignProgress(campaignId, i + 1);
      } else {
        // Check if system is overloaded and campaign should be paused
        if (callResult.shouldPauseCampaign) {
          console.log(`⏸️ System overloaded - pausing campaign: ${campaignId}`);
          await pauseCampaign(campaignId);
          break;
        } else {
          failedCall++;
          console.error(`❌ Call ${i + 1}/${listData.length}: ${contact.number} - ${callResult.error}`);
          await updateCampaignProgress(campaignId, i + 1);
        }
      }
      
      callsInLastMinute++;
      await updateCampaignActivity(campaignId, connectedCall + failedCall);
      
      const subsequentWait = parseInt(process.env.SUBSEQUENT_CALL_WAIT) || 1000;
      await new Promise(resolve => setTimeout(resolve, subsequentWait));
    }
    
    // Campaign completion handling
    const finalState = await getCampaignState(campaignId);
    if (finalState.status === "running") {
      console.log(`🏁 Campaign completed: ${campaignId} - Connected: ${connectedCall}, Failed: ${failedCall}`);
      await completeCampaign(campaignId, failedCall, connectedCall);
    }
    
  } catch (error) {
    console.error(`❌ Error in enhanced campaign processing: ${campaignId}`, error);
    // Mark campaign as failed but don't throw - preserve partial results
    await markCampaignFailed(campaignId, error.message);
  } finally {
    // Always stop heartbeat when campaign processing ends
    if (heartbeatActive) {
      await stopHeartbeat(campaignId);
    }
  }
}

// Legacy function maintained for backward compatibility
async function initiateCalls(listData, fromNumber, wssUrl, clientId, listId, campaignId) {
  console.log(`🔄 Legacy initiateCalls called - redirecting to enhanced processing`);
  return processEnhancedCampaign(campaignId, listData, fromNumber, wssUrl, clientId, listId, null);
}


// Legacy wait function - now handled by database-driven concurrency system
// Kept for backward compatibility but functionality moved to activeCalls.js
async function waitForAvailableSlot() {
  console.warn('⚠️  Legacy waitForAvailableSlot called - consider using database-driven concurrency');
  // This function is now replaced by the waitForAvailableSlot in activeCalls.js
  // which is automatically called by processSingleCall
}
async function getContactsFromList(number, listId) {
  try {
    await connectToMongo(); // Ensure MongoDB connection

    const database = client.db("talkGlimpass");
    const collection = database.collection("plivo-list-data");

    // Extract the last 10 digits of the provided number
    const last10Digits = number.slice(-10);

    // Query to find records where the last 10 digits match and listId matches
    const matchingContacts = await collection
      .find({
        number: { $regex: last10Digits + "$" }, // Regex to match last 10 digits
        listId: new ObjectId(listId), // Ensure the contact belongs to the given list
      })
      .toArray();
    return { status: 200, data: matchingContacts};
  } catch (error) {
    console.error("Error fetching matching contacts:", error);
    return { status: 500, data: error };
  }
}

// Balance validation functions for campaign management
async function validateClientBalance(clientId, estimatedCost = 0) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const clientCollection = database.collection("client");
    
    const clientDoc = await clientCollection.findOne({ _id: new ObjectId(clientId) });
    if (!clientDoc) {
      return {
        success: false,
        error: 'Client not found',
        balance: 0
      };
    }
    
    const currentBalance = clientDoc.availableBalance || 0;
    const hasValidBalance = currentBalance > 0; // Must have positive balance to start
    const canAffordEstimate = estimatedCost === 0 || currentBalance >= estimatedCost;
    
    return {
      success: hasValidBalance, // Only require positive balance to start
      balance: currentBalance,
      estimatedCost: estimatedCost,
      deficit: estimatedCost > currentBalance ? (estimatedCost - currentBalance) : 0,
      canStart: hasValidBalance,
      canAfford: canAffordEstimate,
      message: !hasValidBalance ? 'Insufficient balance: Balance must be positive to start' :
               !canAffordEstimate ? `Warning: Need ${estimatedCost} credits, have ${currentBalance} (campaign will pause when balance exhausts)` :
               'Balance validation passed'
    };
  } catch (error) {
    console.error('❌ Error validating client balance:', error);
    return {
      success: false,
      error: error.message,
      balance: 0
    };
  }
}

async function getCurrentClientBalance(clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const clientCollection = database.collection("client");
    
    const clientDoc = await clientCollection.findOne({ _id: new ObjectId(clientId) });
    if (!clientDoc) {
      return { success: false, balance: 0, error: 'Client not found' };
    }
    
    return {
      success: true,
      balance: clientDoc.availableBalance || 0,
      client: clientDoc
    };
  } catch (error) {
    console.error('❌ Error getting client balance:', error);
    return { success: false, balance: 0, error: error.message };
  }
}

// Update all callBillingDetails entries for a campaign with actual credits
async function updateCampaignCallCredits(campaignId, totalCost, totalDuration) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const { saveCallBillingDetail } = require('../billing/billingCore');
    
    // Calculate credit per second for this campaign
    const creditPerSecond = totalDuration > 0 ? totalCost / totalDuration : 0;
    
    console.log(`📊 Updating callBillingDetails for campaign ${campaignId}: ${totalCost} total credits over ${totalDuration} seconds`);
    
    // Get all callBillingDetails entries for this campaign
    const callBillingCollection = database.collection("callBillingDetails");
    const campaignCalls = await callBillingCollection.find({ 
      campaignId: campaignId,
      type: 'campaign'
    }).toArray();
    
    // Update each call with proportional credits
    for (const call of campaignCalls) {
      const callCredits = call.duration * creditPerSecond;
      await callBillingCollection.updateOne(
        { _id: call._id },
        { 
          $set: { 
            credits: callCredits,
            telephonyCredits: callCredits,
            updatedAt: new Date()
          } 
        }
      );
    }
    
    console.log(`✅ Updated ${campaignCalls.length} callBillingDetails entries with actual credits`);
    
  } catch (error) {
    console.error('❌ Error updating campaign call credits:', error);
  }
}

// Process campaign-level aggregate billing when campaign ends (completed/cancelled/failed)
async function processCampaignAggregatedBilling(campaignId, campaignName, reportData, clientId, campaignStatus = 'completed') {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const clientCollection = database.collection("client");
    const billingHistoryCollection = database.collection("billingHistory");
    const campaignCollection = database.collection("plivoCampaign");
    
    // CRITICAL FIX: Check if billing already processed to prevent duplicates
    console.log(`🔍 Checking billing status for campaign ${campaignId} before processing...`);
    
    // First check the campaign's billing status
    const campaign = await campaignCollection.findOne({ _id: new ObjectId(campaignId) });
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    
    if (campaign.isBalanceUpdated === true) {
      console.log(`✅ Campaign ${campaignName} billing already processed - skipping duplicate billing`);
      return;
    }
    
    // Double-check: Look for existing billing entries for this campaign
    const existingBilling = await billingHistoryCollection.findOne({ 
      campaignId: campaignId,
      desc: { $regex: `Campaign (completed|cancelled|failed): ${campaignName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
    });
    
    if (existingBilling) {
      console.log(`⚠️ Found existing billing entry for campaign ${campaignName} - marking as processed and skipping`);
      // Update the campaign to prevent future attempts
      await campaignCollection.updateOne(
        { _id: new ObjectId(campaignId) },
        { $set: { isBalanceUpdated: true, billingProcessedAt: new Date() } }
      );
      return;
    }
    
    console.log(`💰 Processing NEW billing for campaign ${campaignName} (status: ${campaignStatus})`);
    
    // Calculate total duration from all calls in the campaign (may be 0)
    const totalDuration = reportData.totalDuration || 0;
    const totalCreditsToDeduct = totalDuration; // 1 second = 1 credit
    const callCount = reportData.data ? reportData.data.length : 0;
    
    console.log(`📋 Processing campaign ${campaignStatus} billing history for ${campaignName}: ${totalCreditsToDeduct} credits (${totalDuration}s total, ${callCount} calls)`);
    
    // Get current client balance (for billing history record - balance already updated per call)
    const existingClient = await clientCollection.findOne({ _id: new ObjectId(clientId) });
    if (!existingClient) {
      throw new Error(`Client not found: ${clientId}`);
    }
    
    const currentBalance = existingClient.availableBalance || 0;
    
    // NOTE: Client balance is NOT updated here since it's already updated per individual call
    console.log(`📋 Current balance (already updated per call): ${currentBalance}`);
    
    // Generate appropriate description based on campaign outcome
    let description, transactionType;
    if (campaignStatus === 'completed') {
      description = `Campaign completed: ${campaignName} - ${callCount} calls, ${totalDuration} seconds total`;
      transactionType = 'Dr'; // Debit (even if 0)
    } else if (campaignStatus === 'cancelled') {
      description = `Campaign cancelled: ${campaignName} - ${callCount} calls processed before cancellation, ${totalDuration} seconds total`;
      transactionType = 'Dr'; // Debit for usage before cancellation
    } else if (campaignStatus === 'failed') {
      description = `Campaign failed: ${campaignName} - ${callCount} calls processed before failure, ${totalDuration} seconds total`;
      transactionType = 'Dr'; // Debit for usage before failure
    } else {
      description = `Campaign ended (${campaignStatus}): ${campaignName} - ${callCount} calls, ${totalDuration} seconds total`;
      transactionType = 'Dr';
    }
    
    // Create single aggregate billing history entry for the entire campaign (ALWAYS)
    const billingEntry = {
      clientId: clientId,
      camp_name: campaignName,
      campaignId: campaignId,
      balanceCount: -totalCreditsToDeduct, // Negative for deductions (may be 0)
      date: new Date(),
      desc: description,
      transactionType: transactionType,
      newAvailableBalance: currentBalance, // Current balance (already updated per call)
      callUUID: null, // Not applicable for aggregate entry
      callDuration: totalDuration,
      callType: 'campaign_aggregate',
      from: null, // Not applicable for aggregate
      to: null // Not applicable for aggregate
    };
    
    const historyResult = await billingHistoryCollection.insertOne(billingEntry);
    console.log(`✅ Campaign aggregate billing entry created: ${historyResult.insertedId}`);
    
    // Update all callBillingDetails entries with actual credits
    await updateCampaignCallCredits(campaignId, totalCreditsToDeduct, totalDuration);
    
    // CRITICAL: Mark campaign as billing processed to prevent future duplicates
    await campaignCollection.updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          isBalanceUpdated: true, 
          billingProcessedAt: new Date(),
          billingEntryId: historyResult.insertedId 
        } 
      }
    );
    
    // NOTE: No balance update broadcast here since individual calls already handle real-time updates
    console.log(`✅ Campaign billing history completed (${campaignStatus}): billing entry created for ${totalCreditsToDeduct} credits. Balance already updated per call: ${currentBalance}`);
    console.log(`🔒 Campaign ${campaignId} marked as billing processed to prevent duplicates`);
    
    return {
      success: true,
      creditsDeducted: totalCreditsToDeduct,
      newBalance: currentBalance // Current balance (already updated per call)
    };
    
  } catch (error) {
    console.error('❌ Error in campaign aggregate billing:', error);
    throw error;
  }
}

// Enhanced billing function that handles ALL call types: incoming, campaigns, and test calls
async function updateClientBalance(hangupData){
  console.log('🔄 Processing billing for call:', hangupData.CallUUID, 'Type:', hangupData.campId)
  
  let clientLookupNumber;
  let callType;
  let billingDescription;
  
  // Determine call type and which number to use for client lookup
  if (hangupData.campId === 'incoming') {
    // For incoming calls, client is the receiver (To number)
    clientLookupNumber = hangupData.To;
    callType = 'incoming';
    billingDescription = `Incoming call from ${hangupData.From} for ${hangupData.Duration} seconds`;
  } else if (hangupData.campId === 'testcall') {
    // For test calls, client is the caller (From number) 
    clientLookupNumber = hangupData.From;
    callType = 'testcall';
    billingDescription = `Test call to ${hangupData.To} for ${hangupData.Duration} seconds`;
  } else {
    // For campaign calls, client is the caller (From number)
    clientLookupNumber = hangupData.From;
    callType = 'campaign';
    billingDescription = `Campaign call to ${hangupData.To} for ${hangupData.Duration} seconds (Campaign: ${hangupData.campId})`;
  }

  // Generate possible number formats for lookup
  let numberWithZero = clientLookupNumber
  let numberWithoutZero = clientLookupNumber
  let numberWithPlus = clientLookupNumber
  const possibleNumbers = [clientLookupNumber];
  
  if (clientLookupNumber.startsWith('91') && clientLookupNumber.length === 12) {
    numberWithZero = '0' + clientLookupNumber.slice(2);
    numberWithoutZero = clientLookupNumber.slice(2);
    numberWithPlus =  '+' + clientLookupNumber
    possibleNumbers.push(numberWithoutZero);
    possibleNumbers.push(numberWithPlus);
  }
  if (numberWithZero !== clientLookupNumber) {
    possibleNumbers.push(numberWithZero);
  }

  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("client");
    
    console.log('🔍 Looking up client for', callType, 'call using numbers:', possibleNumbers)
    
    // Find the client by callerNumbers
    const existingClient = await collection.findOne({callerNumbers: { $in: possibleNumbers }});

    if (!existingClient) {
      console.log('❌ Client not found for numbers:', possibleNumbers)
      return { status: 404, message: `Client not found for ${callType} call` };
    }

    // Calculate billing amount (1 second = 1 credit)
    const duration = parseInt(hangupData.Duration) || 0;
    const billingAmount = duration; // 1s = 1 credit
    const updatedBalance = (existingClient.availableBalance || 0) - billingAmount;

    console.log(`💰 Billing ${callType} call: ${billingAmount} credits (${duration}s) - New balance: ${updatedBalance}`);

    // Update client balance
    await collection.updateOne(
      { _id: existingClient._id },
      { $set: { availableBalance: updatedBalance } }
    );

    // Broadcast balance update via SSE to connected clients
    console.log(`🔍 SSE Broadcast Check: Function available=${!!broadcastBalanceUpdate}, Type=${typeof broadcastBalanceUpdate}`);
    if (broadcastBalanceUpdate && typeof broadcastBalanceUpdate === 'function') {
      try {
        console.log(`📡 Broadcasting balance update: ${existingClient._id.toString()} -> ${updatedBalance} credits`);
        broadcastBalanceUpdate(existingClient._id.toString(), updatedBalance, 'call_end');
      } catch (error) {
        console.warn('Failed to broadcast balance update:', error.message);
      }
    } else {
      console.warn('⚠️ SSE broadcast function not available - balance updates will not be sent to connected clients');
    }

    // Record billing entry
    await recordBillingEntry(existingClient._id, hangupData, callType, billingDescription, billingAmount, updatedBalance);
    
    return {
      status: 200,
      message: `${callType} call billing updated successfully`,
      billingAmount,
      updatedBalance,
      callType
    };
  } catch (error) {
    console.error("❌ Error updating client balance:", error);
    return { status: 500, message: "Internal server error", error };
  }
}

// Record billing entry in appropriate collections
async function recordBillingEntry(clientId, hangupData, callType, description, billingAmount, newAvailableBalance) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    console.log(`💾 Recording billing entry: ${callType} - ${billingAmount} credits`);
    
    // ENHANCED: Save detailed call record to new callBillingDetails collection
    const callBillingCollection = database.collection("callBillingDetails");
    const callBillingDetail = {
      clientId: clientId.toString(),
      callUuid: hangupData.CallUUID,
      timestamp: new Date(),
      type: callType, // campaign, incoming, testcall
      duration: parseInt(hangupData.Duration) || 0,
      from: hangupData.From,
      to: hangupData.To,
      credits: billingAmount,
      aiCredits: 0, // Will be updated later via bot endpoint
      telephonyCredits: billingAmount, // Initial telephony cost
      campaignId: callType === 'campaign' ? hangupData.campId : null,
      campaignName: callType === 'campaign' ? `Campaign ${hangupData.campId}` : null
    };
    
    const callDetailResult = await callBillingCollection.insertOne(callBillingDetail);
    console.log(`✅ Call billing detail saved: ${callDetailResult.insertedId}`);
    
    // Create billing entry for billing history (used by /exotel/get-billing-history-by-clientId)
    const billingHistoryCollection = database.collection("billingHistory");
    const billingEntry = {
      clientId: clientId.toString(),
      camp_name: callType === 'campaign' ? `Campaign ${hangupData.campId}` : callType === 'testcall' ? 'Test Call' : 'Incoming Call',
      campaignId: callType === 'campaign' ? hangupData.campId : '',
      balanceCount: -billingAmount, // Negative for deductions
      date: new Date(),
      desc: description,
      transactionType: 'Dr', // Debit entry
      newAvailableBalance: newAvailableBalance, // Updated balance after deduction
      callUUID: hangupData.CallUUID,
      callDuration: parseInt(hangupData.Duration) || 0,
      callType: callType,
      from: hangupData.From,
      to: hangupData.To
    };
    
    const historyResult = await billingHistoryCollection.insertOne(billingEntry);
    console.log(`✅ Billing history recorded: ${historyResult.insertedId}`);
    
    // For incoming calls, also record in legacy incomingBilling collection
    if (callType === 'incoming') {
      const incomingBillingCollection = database.collection("incomingBilling");
      const incomingEntry = {
        clientId: clientId.toString(),
        clientNumber: hangupData.To,
        incomingNumber: hangupData.From,
        createdAt: new Date(),
        Duration: hangupData.Duration,
        desc: description,
        CallUUID: hangupData.CallUUID
      };
      
      const incomingResult = await incomingBillingCollection.insertOne(incomingEntry);
      console.log(`✅ Incoming billing recorded: ${incomingResult.insertedId}`);
    }
    
    return {
      status: 200,
      message: "Billing entry recorded successfully",
      billingHistoryId: historyResult.insertedId
    };
    
  } catch (error) {
    console.error("❌ Error recording billing entry:", error);
    return { status: 500, message: "Failed to record billing entry", error };
  }
}

// Legacy function for backward compatibility - now routes to enhanced function
async function updateIncomingClientBalance(hangupData){
  return await updateClientBalance(hangupData);
}

async function updateIncomingBilling(clientId, hangupData) {
  try{
    // console.log('billing: ', hangupData, clientId)
    await connectToMongo(); // Ensure MongoDB connection

    const database = client.db("talkGlimpass");
    const collection = database.collection("incomingBilling");
    const result = await collection.insertOne({ clientId: clientId.toString(), clientNumber: hangupData.To, incomingNumber: hangupData.From, createdAt: new Date(), Duration: hangupData.Duration, desc: `Incoming call from ${hangupData.From} for ${hangupData.Duration} second`});

    // Return the inserted document's ID
    console.log(`${result.insertedId} inserted sucessfully`)
    return { status: 200, billingId: result.insertedId, message: "List inserted successfully." };

  } catch (error) {
    console.error("Error updating incomingBilling:", error);
    return { status: 500, message: "Internal server error", error };
  }
}

async function  getIncomingBilling(clientId, number) {
  try {
    await connectToMongo(); // Ensure MongoDB connection

    const database = client.db("talkGlimpass");
    const collection = database.collection("incomingBilling");

    // Build the query object
    const query = {
      clientId: clientId.toString(),
    };

    if (number) {
      query.clientNumber = number;
    }

    const results = await collection
      .find(query)
      .sort({ createdAt: -1 }) // optional: sort by newest first
      .toArray();

    return {
      status: 200,
      message: "Billing records fetched successfully.",
      data: results,
    };
  } catch (error) {
    console.error("Error fetching incomingBilling:", error);
    return {
      status: 500,
      message: "Internal server error",
      error,
    };
  }
}

async function saveSingleLeadData(leadData, clientData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("leadData");
    leadData.clientId = clientData._id.toString();
    leadData.isCallCompleted = false;

    const result = await collection.insertOne(leadData)

    return { status: 200,  message: "LeadData inserted successfully." };

  } catch(error){
    return {
      status: 500,
      message: "Internal server error",
      error,
    };
  }
}
// Enhanced campaign state management functions
async function getCampaignState(campaignId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    const campaign = await collection.findOne(
      { _id: new ObjectId(campaignId) },
      { 
        projection: { 
          status: 1, 
          currentIndex: 1, 
          totalContacts: 1, 
          processedContacts: 1,
          heartbeat: 1,
          pausedAt: 1,
          pausedBy: 1,
          resumedAt: 1
        } 
      }
    );
    
    return campaign;
  } catch (error) {
    console.error(`❌ Error getting campaign state: ${campaignId}`, error);
    return null;
  }
}

async function updateCampaignProgress(campaignId, currentIndex) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    const updateData = {
      currentIndex: currentIndex,
      lastActivity: new Date()
    };
    
    await collection.updateOne(
      { _id: new ObjectId(campaignId) },
      { $set: updateData }
    );
    
    console.log(`📊 Campaign ${campaignId}: Updated position to ${currentIndex}`);
  } catch (error) {
    console.error(`❌ Error updating campaign progress: ${campaignId}`, error);
  }
}

async function updateCampaignPauseReason(campaignId, reason, additionalInfo = null) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    const updateData = {
      pauseReason: reason,
      pauseAdditionalInfo: additionalInfo,
      pausedAt: new Date(),
      lastActivity: new Date()
    };
    
    await collection.updateOne(
      { _id: new ObjectId(campaignId) },
      { $set: updateData }
    );
    
    console.log(`📊 Campaign ${campaignId}: Updated pause reason to ${reason} (${additionalInfo})`);
  } catch (error) {
    console.error(`❌ Error updating campaign pause reason: ${campaignId}`, error);
  }
}


async function updateCampaignActivity(campaignId, processedCount) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    await collection.updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          processedContacts: processedCount,
          lastActivity: new Date()
        } 
      }
    );
  } catch (error) {
    console.error(`❌ Error updating campaign activity: ${campaignId}`, error);
  }
}

// Heartbeat management moved to centralized heartbeat manager
// Import the heartbeat manager for campaign health monitoring
const { startCampaignHeartbeat: startHeartbeat, stopCampaignHeartbeat: stopHeartbeat } = require('../../utils/heartbeatManager.js');

async function completeCampaign(campaignId, failedCalls, connectedCalls) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    await collection.updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          status: "completed",
          failedCall: failedCalls,
          connectedCall: connectedCalls,
          isCampaignCompleted: true,
          lastActivity: new Date(),
          heartbeat: null // Stop heartbeat tracking
        } 
      }
    );
    
    // Stop heartbeat timer
    await stopHeartbeat(campaignId);
    
    console.log(`🏁 Campaign marked as completed: ${campaignId}`);
  } catch (error) {
    console.error(`❌ Error completing campaign: ${campaignId}`, error);
  }
}

async function markCampaignFailed(campaignId, errorMessage) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    await collection.updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          status: "failed",
          lastActivity: new Date(),
          heartbeat: null, // Stop heartbeat tracking
          errorMessage: errorMessage
        } 
      }
    );
    
    // Stop heartbeat timer
    await stopHeartbeat(campaignId);
    
    console.log(`❌ Campaign marked as failed: ${campaignId} - ${errorMessage}`);
  } catch (error) {
    console.error(`❌ Error marking campaign as failed: ${campaignId}`, error);
  }
}

// Campaign cancel functionality
async function cancelCampaign(campaignId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    // First check if campaign exists and get its current status
    const campaign = await collection.findOne({ _id: new ObjectId(campaignId) });
    
    if (!campaign) {
      return { success: false, error: "Campaign not found" };
    }
    
    // Check current status - can only cancel running or paused campaigns
    if (campaign.status === "cancelled") {
      return { success: false, error: "Campaign is already cancelled" };
    }
    
    if (campaign.status === "completed") {
      return { success: false, error: "Cannot cancel completed campaign" };
    }
    
    if (campaign.status === "failed") {
      return { success: false, error: "Cannot cancel failed campaign" };
    }

    if (!["running", "paused", "scheduled"].includes(campaign.status)) {
      return { success: false, error: `Cannot cancel campaign with status: ${campaign.status}` };
    }
    
    // Update to cancelled
    const result = await collection.updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          status: "cancelled",
          cancelledAt: new Date(),
          lastActivity: new Date(),
          heartbeat: null // Stop heartbeat when cancelled
        } 
      }
    );
    
    // Stop heartbeat timer
    await stopHeartbeat(campaignId);
    
    console.log(`🛑 Campaign cancelled: ${campaignId}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Error cancelling campaign: ${campaignId}`, error);
    return { success: false, error: error.message };
  }
}

// Campaign pause functionality
async function pauseCampaign(campaignId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    // First check if campaign exists and get its current status
    const campaign = await collection.findOne({ _id: new ObjectId(campaignId) });
    
    if (!campaign) {
      return { success: false, error: "Campaign not found" };
    }
    
    // Check current status and provide specific error messages
    if (campaign.status === "paused") {
      return { success: false, error: "Campaign is already paused" };
    }
    
    if (campaign.status === "completed") {
      return { success: false, error: "Cannot pause completed campaign" };
    }
    
    if (campaign.status === "cancelled") {
      return { success: false, error: "Cannot pause cancelled campaign" };
    }
    
    if (campaign.status === "failed") {
      return { success: false, error: "Cannot pause failed campaign" };
    }
    
    if (campaign.status !== "running") {
      return { success: false, error: `Cannot pause campaign with status: ${campaign.status}` };
    }
    
    // Now update to paused
    const result = await collection.updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          status: "paused",
          pausedAt: new Date(),
          lastActivity: new Date(),
          heartbeat: null // Stop heartbeat when paused
        } 
      }
    );
    
    // Stop heartbeat timer
    await stopHeartbeat(campaignId);
    
    console.log(`⏸️ Campaign paused: ${campaignId}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Error pausing campaign: ${campaignId}`, error);
    return { success: false, error: error.message };
  }
}

// Simple campaign resume functionality
async function resumeCampaign(campaignId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    const activeCallsCollection = database.collection("activeCalls");
    
    // Get campaign data for resume processing
    const campaign = await collection.findOne({ _id: new ObjectId(campaignId) });
    
    if (!campaign) {
      return { success: false, error: "Campaign not found" };
    }
    
    // Check current status and provide specific error messages
    if (campaign.status === "running") {
      return { success: false, error: "Campaign is already running" };
    }
    
    if (campaign.status === "completed") {
      return { success: false, error: "Cannot resume completed campaign" };
    }
    
    if (campaign.status === "cancelled") {
      return { success: false, error: "Cannot resume cancelled campaign" };
    }
    
    if (campaign.status === "failed") {
      return { success: false, error: "Cannot resume failed campaign" };
    }
    
    if (campaign.status !== "paused") {
      return { success: false, error: `Cannot resume campaign with status: ${campaign.status}` };
    }
    
    // Simple resume: continue from saved currentIndex
    const resumeIndex = campaign.currentIndex || 0;
    
    // Update status to running
    const { CONTAINER_ID } = require('../../utils/containerLifecycle.js');
    
    const result = await collection.updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          status: "running",
          resumedAt: new Date(),
          lastActivity: new Date(),
          heartbeat: new Date(),
          containerId: CONTAINER_ID,
          pauseReason: null
        } 
      }
    );
    
    if (result.matchedCount === 0) {
      return { success: false, error: "Failed to update campaign status" };
    }
    
    // Get remaining contacts to process
    const listData = await getlistDataById(campaign.listId);
    const remainingContacts = listData.slice(resumeIndex);
    
    console.log(`▶️ Campaign resumed: ${campaignId} from index ${resumeIndex} (${remainingContacts.length} remaining)`);
    
    // Start processing from saved position
    process.nextTick(() => processEnhancedCampaign(
      campaignId, 
      listData, 
      campaign.fromNumber, 
      campaign.wssUrl, 
      campaign.clientId, 
      campaign.listId,
      campaign.provider || null // Use stored campaign provider or null for auto-detection
    ));
    
    return { 
      success: true, 
      message: `Campaign resumed from position ${resumeIndex}`,
      remainingContacts: remainingContacts.length
    };
  } catch (error) {
    console.error(`❌ Error resuming campaign: ${campaignId}`, error);
    return { success: false, error: error.message };
  }
}

// Campaign progress monitoring
async function getCampaignProgress(campaignId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    // Get campaign basic info
    const campaignCollection = database.collection("plivoCampaign");
    const campaign = await campaignCollection.findOne({ _id: new ObjectId(campaignId) });
    
    if (!campaign) {
      return { success: false, error: "Campaign not found" };
    }
    
    // Count call states using our 4-state system
    const activeCallsCollection = database.collection("activeCalls");
    
    // DEBUG: Check total records for this campaign
    const totalRecords = await activeCallsCollection.countDocuments({ campaignId: new ObjectId(campaignId) });
    console.log(`🔍 DEBUG: Total activeCalls records for campaign ${campaignId}: ${totalRecords}`);
    
    // DEBUG: Get sample records to see what's in the database
    const sampleRecords = await activeCallsCollection.find({ campaignId: new ObjectId(campaignId) }).limit(3).toArray();
    console.log(`🔍 DEBUG: Sample activeCalls records:`, sampleRecords.map(r => ({
      callUUID: r.callUUID,
      status: r.status,
      campaignId: r.campaignId,
      from: r.from,
      to: r.to
    })));
    
    const callCounts = await activeCallsCollection.aggregate([
      { $match: { campaignId: new ObjectId(campaignId) } },
      { $group: { 
        _id: "$status", 
        count: { $sum: 1 } 
      } }
    ]).toArray();
    
    console.log(`🔍 DEBUG: Aggregation result:`, callCounts);
    
    // Convert aggregation result to our required format (6-state system)
    const counts = { 
      processed: 0, 
      ringing: 0,
      ongoing: 0,     // Call answered and conversation started
      "call-ended": 0, 
      completed: 0,
      failed: 0       // Calls that timed out or failed
    };
    
    // Handle both new status values and legacy 'active' status
    callCounts.forEach(item => {
      if (item._id === 'active') {
        // Legacy records - count as 'processed'  
        counts.processed += item.count;
        console.log(`🔍 DEBUG: Found ${item.count} legacy 'active' records, counting as 'processed'`);
      } else if (counts.hasOwnProperty(item._id)) {
        counts[item._id] = item.count;
        console.log(`🔍 DEBUG: Found ${item.count} '${item._id}' records`);
      } else {
        console.log(`🔍 DEBUG: Unknown status found: '${item._id}' with count ${item.count}`);
      }
    });
    
    // Determine campaign status using simple rule: completed only when ringing == processed == ongoing == 0
    let campaignStatus = campaign.status;
    console.log(`🔍 DEBUG: Original campaign status: ${campaignStatus}`);
    console.log(`🔍 DEBUG: Campaign processedContacts: ${campaign.processedContacts}, totalContacts: ${campaign.totalContacts}`);
    
    // Always auto-determine status based on call states (ignore database status except for manual overrides)
    if (!['paused', 'cancelled', 'failed'].includes(campaignStatus)) {
      // FIXED: Campaign is completed when call-ended + completed + failed == totalContacts
      const finishedCalls = counts["call-ended"] + counts.completed + counts.failed;
      const totalContacts = campaign.totalContacts || 0;
      
      console.log(`🔍 DEBUG: finishedCalls (call-ended + completed + failed): ${finishedCalls} (${counts["call-ended"]} + ${counts.completed} + ${counts.failed})`);
      console.log(`🔍 DEBUG: totalContacts: ${totalContacts}`);
      console.log(`🔍 DEBUG: activeCalls (processed + ringing + ongoing): ${counts.processed + counts.ringing + counts.ongoing}`);
      
      
      if (finishedCalls >= totalContacts && totalContacts > 0) {
        campaignStatus = 'completed';  // All contacts processed
        console.log(`🔍 DEBUG: Status -> 'completed' (${finishedCalls}/${totalContacts} contacts finished)`);
        
        // Update database with completed status if it's different from current status
        if (campaign.status !== 'completed') {
          console.log(`📊 Updating campaign ${campaignId} status from '${campaign.status}' to 'completed'`);
          await campaignCollection.updateOne(
            { _id: new ObjectId(campaignId) },
            { 
              $set: { 
                status: 'completed',
                completedAt: new Date(),
                lastActivity: new Date()
              }
            }
          );
        }
      } else {
        campaignStatus = 'running';  // Still processing contacts
        console.log(`🔍 DEBUG: Status -> 'running' (${finishedCalls}/${totalContacts} contacts finished, still processing)`);
      }
    } else {
      console.log(`🔍 DEBUG: Status kept as manual override: ${campaignStatus}`);
    }
    
    console.log(`🔥 CRITICAL BUG: Campaign ${campaignId} has ${totalRecords} total records, but all showing as 'completed': ${JSON.stringify(counts)}`);
    
    // NOTE: Aggregate billing is handled by getReportByCampId() only
    // getCampaignProgress() is for status checking, not billing
    
    return {
      success: true,
      campaignId: campaignId,
      campaignName: campaign.campaignName,
      totalContacts: campaign.totalContacts,
      callCounts: counts,
      campaignStatus: campaignStatus
    };
    
  } catch (error) {
    console.error(`❌ Error getting campaign progress: ${campaignId}`, error);
    return { success: false, error: error.message };
  }
}

// Get test call reports (formerly single call reports) - Enhanced with full data enrichment
// Now includes: recording URLs, bot callback data, lead analysis, conversation logs, user interaction data
async function getTestCallReport(clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const hangupCollection = database.collection("plivoHangupData");
    const logCollection = database.collection("logData");
    const recordCollection = database.collection("plivoRecordData");

    // Ensure clientId is a string for consistent matching
    const clientIdStr = clientId?.toString ? clientId.toString() : String(clientId);

    console.log(`📊 Fetching test call report for clientId: ${clientIdStr}`);

    // Fetch all hangup data for test calls (campId = 'testcall') filtered by clientId
    // Include both Plivo and Twilio test calls for unified reporting
    // Use aggregation pipeline to convert EndTime string to Date for proper sorting
    const hangupDataDocs = await hangupCollection.aggregate([
      {
        $match: {
          campId: 'testcall',
          clientId: clientIdStr
          // No provider filter - include both Plivo and Twilio calls
        }
      },
      {
        $addFields: {
          // Convert EndTime string to Date for sorting, fallback to createdAt if EndTime missing
          sortDate: {
            $cond: {
              if: { $ne: ["$EndTime", null] },
              then: { $dateFromString: { dateString: "$EndTime", onError: "$createdAt" } },
              else: "$createdAt"
            }
          }
        }
      },
      {
        $sort: { sortDate: -1 } // Sort by converted date, latest first
      },
      {
        $unset: "sortDate" // Remove the temporary field from results
      }
    ]).toArray();

    if (hangupDataDocs.length === 0) {
      console.log(`📊 No test call data found for clientId: ${clientIdStr}`);
      return { status: 404, message: "No test call data found." };
    }

    console.log(`📊 Found ${hangupDataDocs.length} test calls for clientId: ${clientIdStr}`);

    // Extract unique CallUUIDs from hangupData (support both old 'CallUUID' and new 'callUUID' field names)
    const callUUIDs = hangupDataDocs.map(doc => doc.CallUUID || doc.callUUID).filter(Boolean);

    // Fetch all logData documents based on CallUUIDs (contains bot callback data, lead analysis, etc.)
    const logDataDocs = await logCollection.find({ callUUID: { $in: callUUIDs } }).toArray();

    // Calculate total conversation time from hangup data (more accurate)
    // Support both old 'Duration' and new 'duration' field names
    const totalConversationTime = hangupDataDocs.reduce((sum, doc) => sum + (parseInt(doc.duration || doc.Duration) || 0), 0);

    // Group log data by CallUUID and get the latest entry using ObjectId comparison
    const latestLogDataMap = new Map();
    logDataDocs.forEach(doc => {
      const existingDoc = latestLogDataMap.get(doc.callUUID);
      if (!existingDoc || doc._id > existingDoc._id) {
        latestLogDataMap.set(doc.callUUID, doc);
      }
    });

    // Fetch corresponding records from plivoRecordData (recording URLs)
    const recordDataDocs = await recordCollection.find({ CallUUID: { $in: callUUIDs } }).toArray();

    // Convert recordDataDocs to a Map for fast lookup
    const recordMap = new Map(recordDataDocs.map(record => [record.CallUUID, record.RecordUrl]));

    // Merge logData and record URLs into hangupData (following same pattern as campaign/incoming reports)
    const mergedData = hangupDataDocs.map(hangupDoc => {
      const logData = latestLogDataMap.get(hangupDoc.CallUUID) || {};
      return {
        ...hangupDoc,
        ...logData, // Merge latest log data (includes bot callback data, lead analysis, conversation logs)
        // CRITICAL: Preserve RecordUrl from hangup data (Twilio), fallback to record collection (Plivo)
        RecordUrl: hangupDoc.RecordUrl || recordMap.get(hangupDoc.CallUUID) || null,
        callType: 'testcall' // Mark as test call for identification
      };
    });

    // Data is already sorted by database aggregation pipeline (EndTime latest to oldest)

    return {
      status: 200,
      data: mergedData,
      totalDuration: totalConversationTime,
      message: "Test call data fetched successfully with enriched information."
    };
  } catch (error) {
    console.error("Error fetching enriched test call report:", error);
    return { status: 500, message: "Internal server error." };
  }
}

// Get API call reports (calls initiated via API key) - Enhanced with full data enrichment
// Similar to test calls but filters campId='api-call' instead of 'testcall'
async function getApiCallReport(clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const hangupCollection = database.collection("plivoHangupData");
    const logCollection = database.collection("logData");
    const recordCollection = database.collection("plivoRecordData");

    // Ensure clientId is a string for consistent matching
    const clientIdStr = clientId?.toString ? clientId.toString() : String(clientId);

    console.log(`📊 Fetching API call report for clientId: ${clientIdStr}`);

    // Fetch all hangup data for API calls filtered by clientId
    // Support both normalized format (source='api') and legacy format (campId='api-call')
    // Include both Plivo and Twilio API calls for unified reporting
    // Use aggregation pipeline to convert EndTime string to Date for proper sorting
    const hangupDataDocs = await hangupCollection.aggregate([
      {
        $match: {
          clientId: clientIdStr,
          // Support both normalized (source='api') and legacy (campId='api-call') formats
          $or: [
            { source: 'api' },
            { campId: 'api-call' }
          ]
        }
      },
      {
        $addFields: {
          // Convert EndTime/endTime string to Date for sorting, fallback to createdAt if missing
          // Support both normalized (endTime) and legacy (EndTime) field names
          sortDate: {
            $cond: {
              if: { $or: [{ $ne: ["$EndTime", null] }, { $ne: ["$endTime", null] }] },
              then: {
                $dateFromString: {
                  dateString: { $ifNull: ["$EndTime", "$endTime"] },
                  onError: "$createdAt"
                }
              },
              else: "$createdAt"
            }
          }
        }
      },
      {
        $sort: { sortDate: -1 } // Sort by converted date, latest first
      },
      {
        $unset: "sortDate" // Remove the temporary field from results
      }
    ]).toArray();

    if (hangupDataDocs.length === 0) {
      console.log(`📊 No API call data found for clientId: ${clientIdStr}`);
      return { status: 404, message: "No API call data found." };
    }

    console.log(`📊 Found ${hangupDataDocs.length} API calls for clientId: ${clientIdStr}`);

    // Extract unique CallUUIDs from hangupData
    // Support both normalized (callUUID) and legacy (CallUUID) field names
    const callUUIDs = hangupDataDocs.map(doc => doc.callUUID || doc.CallUUID).filter(Boolean);

    // Fetch all logData documents based on CallUUIDs (contains bot callback data, lead analysis, etc.)
    const logDataDocs = await logCollection.find({ callUUID: { $in: callUUIDs } }).toArray();

    // Calculate total conversation time from hangup data (more accurate)
    // Support both normalized (duration) and legacy (Duration) field names
    const totalConversationTime = hangupDataDocs.reduce((sum, doc) => sum + (parseInt(doc.duration || doc.Duration) || 0), 0);

    // Group log data by CallUUID and get the latest entry using ObjectId comparison
    const latestLogDataMap = new Map();
    logDataDocs.forEach(doc => {
      const existingDoc = latestLogDataMap.get(doc.callUUID);
      if (!existingDoc || doc._id > existingDoc._id) {
        latestLogDataMap.set(doc.callUUID, doc);
      }
    });

    // Fetch corresponding records from plivoRecordData (recording URLs)
    const recordDataDocs = await recordCollection.find({ CallUUID: { $in: callUUIDs } }).toArray();

    // Convert recordDataDocs to a Map for fast lookup
    const recordMap = new Map(recordDataDocs.map(record => [record.CallUUID, record.RecordUrl]));

    // Merge logData and record URLs into hangupData (following same pattern as campaign/incoming reports)
    const mergedData = hangupDataDocs.map(hangupDoc => {
      // Support both normalized (callUUID) and legacy (CallUUID) field names
      const docCallUUID = hangupDoc.callUUID || hangupDoc.CallUUID;
      const logData = latestLogDataMap.get(docCallUUID) || {};
      return {
        ...hangupDoc,
        ...logData, // Merge latest log data (includes bot callback data, lead analysis, conversation logs)
        // Normalize CallUUID field for consistent API response
        CallUUID: docCallUUID,
        // CRITICAL: Preserve recording URL from hangup data (Twilio), fallback to record collection (Plivo)
        // Support both normalized (recordingUrl) and legacy (RecordUrl) field names
        RecordUrl: hangupDoc.recordingUrl || hangupDoc.RecordUrl || recordMap.get(docCallUUID) || null,
        callType: 'api-call' // Mark as API call for identification
      };
    });

    // Data is already sorted by database aggregation pipeline (EndTime latest to oldest)

    return {
      status: 200,
      data: mergedData,
      totalDuration: totalConversationTime,
      message: "API call data fetched successfully with enriched information."
    };
  } catch (error) {
    console.error("Error fetching enriched API call report:", error);
    return { status: 500, message: "Internal server error." };
  }
}

// Campaign Analytics - Comprehensive metrics for individual campaigns
async function getCampaignAnalytics(campaignId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    // Pipeline 1: Campaign basic stats from hangup data
    // Support both old 'campId' and new 'campaignId' field names
    const campaignStatsAggregation = [
      { $match: { $or: [{ campId: campaignId }, { campaignId: campaignId }] } },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          totalDuration: { $sum: { $toInt: { $ifNull: ["$Duration", "0"] } } },
          averageDuration: { $avg: { $toInt: { $ifNull: ["$Duration", "0"] } } }
        }
      }
    ];
    
    const campaignStats = await database.collection("plivoHangupData")
      .aggregate(campaignStatsAggregation, { allowDiskUse: true }).toArray();
    
    if (campaignStats.length === 0) {
      return { status: 404, message: "Campaign not found or no call data available" };
    }
    
    const stats = campaignStats[0];
    
    // Pipeline 2: Simplified lead analysis - direct query on logData
    const leadAnalysis = await database.collection("logData")
      .find({
        $and: [
          // Support both old 'campId' and new 'campaignId' field names
          { $or: [{ campId: campaignId }, { campaignId: campaignId }] },
          { $or: [
          { is_lead: { $regex: /(true|maybe|1)/i } },
          { "lead_analysis.is_lead": { $regex: /(true|maybe|1)/i } },
          { leadAnalysis_is_lead: { $regex: /(true|maybe|1)/i } },
          { lead_status: { $regex: /(true|maybe|1)/i } },
          { isLead: { $regex: /(true|maybe|1)/i } },
          { "lead_analysis.lead_score": { $gt: 0 } }
        ]}
      ]}).toArray();
    
    const totalLeads = leadAnalysis.length;
    
    // Calculate total cost using duration as credits (1 second = 1 credit)
    const totalCost = stats.totalDuration || 0;
    
    // Calculate derived metrics
    const averageDuration = Math.round(stats.averageDuration || 0);
    const costPerLead = totalLeads > 0 ? Math.round((totalCost / totalLeads) * 100) / 100 : 0;
    const costPerCall = stats.totalCalls > 0 ? Math.round((totalCost / stats.totalCalls) * 100) / 100 : 0;
    
    return {
      status: 200,
      data: {
        campaignId: campaignId,
        totalCalls: stats.totalCalls,
        totalDuration: stats.totalDuration,
        averageDuration: averageDuration,
        totalCost: totalCost,
        totalLeads: totalLeads,
        costPerLead: costPerLead,
        costPerCall: costPerCall,
        leadConversionRate: stats.totalCalls > 0 ? Math.round((totalLeads / stats.totalCalls) * 10000) / 100 : 0 // Percentage with 2 decimals
      }
    };
    
  } catch (error) {
    console.error("Error fetching campaign analytics:", error);
    return { status: 500, message: "Internal server error", error: error.message };
  }
}

// Client Analytics - Monthly expenditure and overall statistics
async function getClientAnalytics(clientId, months = 12) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    // Calculate date ranges for monthly analysis
    const currentDate = new Date();
    const startOfCurrentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const startOfLastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const endOfLastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0, 23, 59, 59);
    const startOfAnalysisPeriod = new Date(currentDate.getFullYear(), currentDate.getMonth() - months + 1, 1);
    
    // Simplified Pipeline: Monthly data from call hangup data only (Duration = Credits)
    const monthlyDataAggregation = [
      {
        $match: {
          $or: [
            { clientId: clientId },
            { clientId: clientId.toString() }
          ],
          StartTime: { $gte: startOfAnalysisPeriod.toISOString().replace('T', ' ').substring(0, 19) }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: { $dateFromString: { dateString: "$StartTime" } } },
            month: { $month: { $dateFromString: { dateString: "$StartTime" } } }
          },
          totalCalls: { $sum: 1 },
          totalExpenditure: { $sum: { $toInt: "$Duration" } }, // Duration as credits
          totalDuration: { $sum: { $toInt: "$Duration" } }
        }
      },
      {
        $addFields: {
          monthName: {
            $arrayElemAt: [
              ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
              "$_id.month"
            ]
          }
        }
      },
      {
        $sort: { "_id.year": -1, "_id.month": -1 }
      },
      {
        $limit: 100
      }
    ];

    const monthlyData = await database.collection("plivoHangupData")
      .aggregate(monthlyDataAggregation, { allowDiskUse: true })
      .toArray();
    
    // Simplified current month and last month summary from hangup data
    const currentMonthAggregation = [
      {
        $match: {
          $or: [
            { clientId: clientId },
            { clientId: clientId.toString() }
          ],
          StartTime: { $gte: startOfCurrentMonth.toISOString().replace('T', ' ').substring(0, 19) }
        }
      },
      {
        $group: {
          _id: null,
          currentMonthExpenditure: { $sum: { $toInt: "$Duration" } },
          currentMonthCalls: { $sum: 1 },
          currentMonthDuration: { $sum: { $toInt: "$Duration" } }
        }
      }
    ];

    const lastMonthAggregation = [
      {
        $match: {
          $or: [
            { clientId: clientId },
            { clientId: clientId.toString() }
          ],
          StartTime: {
            $gte: startOfLastMonth.toISOString().replace('T', ' ').substring(0, 19),
            $lte: endOfLastMonth.toISOString().replace('T', ' ').substring(0, 19)
          }
        }
      },
      {
        $group: {
          _id: null,
          lastMonthExpenditure: { $sum: { $toInt: "$Duration" } },
          lastMonthCalls: { $sum: 1 },
          lastMonthDuration: { $sum: { $toInt: "$Duration" } }
        }
      }
    ];

    const [currentMonthData, lastMonthData] = await Promise.all([
      database.collection("plivoHangupData").aggregate(currentMonthAggregation, { allowDiskUse: true }).toArray(),
      database.collection("plivoHangupData").aggregate(lastMonthAggregation, { allowDiskUse: true }).toArray()
    ]);

    // Extract month data
    const currentMonth = currentMonthData.length > 0 ? currentMonthData[0] : {
      currentMonthExpenditure: 0,
      currentMonthCalls: 0,
      currentMonthDuration: 0
    };

    const lastMonth = lastMonthData.length > 0 ? lastMonthData[0] : {
      lastMonthExpenditure: 0,
      lastMonthCalls: 0,
      lastMonthDuration: 0
    };
    
    // Simplified overall client statistics from hangup data only
    const overallStatsAggregation = [
      {
        $match: {
          $or: [
            { clientId: clientId },
            { clientId: clientId.toString() }
          ]
        }
      },
      {
        $group: {
          _id: null,
          totalLifetimeExpenditure: { $sum: { $toInt: "$Duration" } },
          totalLifetimeDuration: { $sum: { $toInt: "$Duration" } },
          totalLifetimeCalls: { $sum: 1 },
          averageCallCost: { $avg: { $toInt: "$Duration" } },
          firstTransactionDate: { $min: { $dateFromString: { dateString: "$StartTime" } } },
          lastTransactionDate: { $max: { $dateFromString: { dateString: "$StartTime" } } }
        }
      }
    ];

    const overallStatsData = await database.collection("plivoHangupData")
      .aggregate(overallStatsAggregation, { allowDiskUse: true })
      .toArray();

    const overall = overallStatsData.length > 0 ? overallStatsData[0] : {
      totalLifetimeExpenditure: 0,
      totalLifetimeDuration: 0,
      totalLifetimeCalls: 0,
      averageCallCost: 0,
      firstTransactionDate: null,
      lastTransactionDate: null
    };
    
    // Calculate month-over-month growth
    const expenditureGrowth = lastMonth.lastMonthExpenditure > 0 ?
      Math.round(((currentMonth.currentMonthExpenditure - lastMonth.lastMonthExpenditure) / lastMonth.lastMonthExpenditure) * 10000) / 100 : 0;
    
    return {
      status: 200,
      data: {
        clientId: clientId,
        currentMonth: {
          expenditure: Math.round(currentMonth.currentMonthExpenditure * 100) / 100,
          calls: currentMonth.currentMonthCalls,
          duration: currentMonth.currentMonthDuration
        },
        lastMonth: {
          expenditure: Math.round(lastMonth.lastMonthExpenditure * 100) / 100,
          calls: lastMonth.lastMonthCalls,
          duration: lastMonth.lastMonthDuration
        },
        growth: {
          expenditureGrowthPercent: expenditureGrowth,
          callGrowthPercent: lastMonth.lastMonthCalls > 0 ? 
            Math.round(((currentMonth.currentMonthCalls - lastMonth.lastMonthCalls) / lastMonth.lastMonthCalls) * 10000) / 100 : 0
        },
        lifetime: {
          totalExpenditure: Math.round(overall.totalLifetimeExpenditure * 100) / 100,
          totalCalls: overall.totalLifetimeCalls,
          totalDuration: overall.totalLifetimeDuration,
          averageCallCost: Math.round(overall.averageCallCost * 100) / 100,
          firstTransactionDate: overall.firstTransactionDate,
          lastTransactionDate: overall.lastTransactionDate
        },
        monthlyBreakdown: monthlyData.map(month => ({
          year: month._id.year,
          month: month._id.month,
          monthName: month.monthName,
          expenditure: Math.round(month.totalExpenditure * 100) / 100,
          calls: month.totalCalls,
          duration: month.totalDuration
        }))
      }
    };
    
  } catch (error) {
    console.error("Error fetching client analytics:", error);
    return { status: 500, message: "Internal server error", error: error.message };
  }
}

  module.exports = {
    insertList,
    insertListContent,
    getListByClientId,
    getlistDataById,
    initiatePlivoCall,
    makeCallViaCampaign,
    getCampaignByClientId,
    saveRecordData,
    getReportByCampId,
    deleteList,
    updateList,
    getContactfromListId,
    saveHangupData,
    getIncomingReport,
    getContactsFromList,
    retryCampaign,
    getCampaignStatus,
    updateIncomingClientBalance,
    getIncomingBilling,
    saveSingleLeadData,
    getTestCallReport,
    getApiCallReport, // New: API call report function
    // Enhanced campaign management functions
    cancelCampaign,
    pauseCampaign,
    resumeCampaign,
    getCampaignProgress,
    getCampaignState,
    processEnhancedCampaign,
    // Balance validation functions
    validateClientBalance,
    getCurrentClientBalance,
    // Analytics functions
    getCampaignAnalytics,
    getClientAnalytics
  }