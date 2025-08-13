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

  async function initiatePlivoCall(from, to, wssUrl, clientId, listDataStringify, uploadedName= '', tag = '', listId = 'incoming', camp_id = 'incoming') {
    const plivoApiUrl = 'https://api.plivo.com/v1/Account/MAMTBIYJUYNMRINGQ4ND/Call/';
    
    // Get base URL from environment variable, fallback to default if not set
    const baseUrl = process.env.BASE_URL || 'https://application.glimpass.com';
    
    const payload = {
      from,
      to,
      ring_url: `${baseUrl}/plivo/ring-url`,
      hangup_url: `${baseUrl}/plivo/hangup-url?campId=${camp_id}&hangupFirstName=${uploadedName}&tag=${tag}`,
      answer_url: `${baseUrl}/ip/xml-plivo?wss=${wssUrl}&clientId=${clientId}&listId=${listId}&campId=${camp_id}&firstName=${uploadedName}&csvData=${listDataStringify}`,
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
            'Authorization': 'Basic TUFNVEJJWUpVWU5NUklOR1E0TkQ6WlRWa1pUVm1ZMlkzWW1SaU9URTNNelEzTWpVME1tSTVObVJrTTJJNA==',
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
  

async function createCampaign(campaignName, listId, fromNumber, wssUrl, clientId, isBalanceUpdated, isCampaignCompleted) {
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
    
    // Insert the new campaign with enhanced fields for pause/resume functionality
    const result = await collection.insertOne({
      // Original fields
      campaignName,
      listId,
      fromNumber,
      wssUrl,
      clientId,
      createdAt: new Date(),
      isBalanceUpdated,
      isCampaignCompleted,
      
      // Enhanced fields for pause/resume functionality
      status: "running",           // "running", "paused", "completed", "cancelled"
      currentIndex: 0,             // Current position in contact list
      totalContacts: totalContacts, // Total contacts from list
      processedContacts: 0,        // Number of contacts processed
      
      // Cloud Run heartbeat fields
      heartbeat: new Date(),       // Last heartbeat timestamp
      lastActivity: new Date(),    // Last processing activity
      containerId: containerId,    // Container processing this campaign
      
      // Pause/resume tracking
      pausedAt: null,              // When campaign was paused
      pausedBy: null,              // User who paused campaign
      resumedAt: null              // When campaign was resumed
    });

    console.log(`📊 Campaign created: ${campaignName} (${result.insertedId}) - ${totalContacts} contacts`);
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

    const listData = collection.find({listId: new ObjectId(listId)}).toArray();

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

async function saveHangupData(hangupData) {
  try {
    await connectToMongo(); // Ensure MongoDB connection

    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoHangupData");

    // Insert the new record since no duplicate exists
    await collection.insertOne(hangupData);
    console.log("hangup data saved successfully.")
    return { status: 201, message: "hangup data saved successfully." }; // Created status
  } catch (error) {
    console.error("Error saving  hangup data:", error);
    return { status: 500, message: "Internal server error." };
  }
}

// async function handleCallCompletion() {
//     activeCalls.activeCalls.count = Math.max(0, activeCalls.activeCalls.count - 1); // Ensure it never goes below 0
//     console.log(`Call ended, Active calls: ${activeCalls.activeCalls.count}`);
// }

async function getReportByCampId(campId) {
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
  
  // Get actual campaign status from database
  const campaignStatus = campData[0].status || 'running'
  
  // Always try to get partial results, even if campaign is not completed
  const reportData = await getMergedLogData(campId)
  
  // Calculate campaign duration
  let campDuration = reportData.totalDuration
  if(campDuration){
    campDuration = Math.ceil(campDuration)
  } else{
    campDuration = 0
  }
  
  // DEPRECATED: Old billing system removed - campaigns now billed per call via hangup webhook
  // Individual calls are billed in real-time via the hangup webhook using NEW billing system
  // Campaign completion no longer triggers separate billing - all done per call
  if(campaignStatus === 'completed' && !isBalanceUpdated){
    // Just mark as balance updated to prevent future old billing calls
    updateCampaignBalanceStatus(campId, true)
    console.log(`✅ Campaign ${campaignName} completed - billing handled per call via NEW system`);
  }
  
  // Add campaign status to the response
  if (reportData.status === 200) {
    return {
      ...reportData,
      campaignStatus: campaignStatus,
      completedCalls: hangupDataCount,
      totalScheduledCalls: connectedCall,
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
      totalScheduledCalls: connectedCall,
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

    // Count documents where campaignId matches
    const count = await collection.countDocuments({ campId });

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

async function getMergedLogData(campId) {
  try {
    await connectToMongo(); // Ensure MongoDB connection

    const database = client.db("talkGlimpass");
    const hangupCollection = database.collection("plivoHangupData");
    const logCollection = database.collection("logData");
    const recordCollection = database.collection("plivoRecordData");

    // Fetch all hangup data based on campId
    const hangupDataDocs = await hangupCollection.find({ campId }).toArray();

    if (hangupDataDocs.length === 0) {
      return { status: 404, message: "No hangup data found for the given campId." };
    }

    // Extract unique CallUUIDs from hangupData
    const callUUIDs = hangupDataDocs.map(doc =>{ return doc.CallUUID });

    // Fetch all logData documents based on CallUUIDs
    const logDataDocs = await logCollection.find({ callUUID: { $in: callUUIDs } }).toArray();

    const totalConversationTime = hangupDataDocs.reduce((sum, doc) => sum + (parseInt(doc.Duration) || 0), 0);

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
      const logData = latestLogDataMap.get(hangupDoc.CallUUID) || {};
      return {
        ...hangupDoc,
        ...logData, // Merge latest log data
        RecordUrl: recordMap.get(hangupDoc.CallUUID) || null, // Attach RecordUrl if found
      };
    });

    return { 
      status: 200, 
      data: mergedData, 
      totalDuration: totalConversationTime, 
      message: "Merged data fetched successfully."
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
      const logData = latestLogDataMap.get(hangupDoc.CallUUID) || {};
      return {
        ...hangupDoc,
        ...logData, // Merge latest log data
        RecordUrl: recordMap.get(hangupDoc.CallUUID) || null, // Attach RecordUrl if found
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


async function makeCallViaCampaign(listId, fromNumber, wssUrl, campaignName, clientId) {
  try {
      const listData = await getlistDataById(listId);
      const result = await createCampaign(campaignName, listId, fromNumber, wssUrl, clientId, false, false);
      if (result === 0) {
          return { status: 500, message: 'Error while creating the campaign' };
      }
      
      // Handle new error response format
      if (result && typeof result === 'object' && result.status) {
          return result;
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
      process.nextTick(() => processEnhancedCampaign(result, listData, fromNumber, wssUrl, clientId, listId));
      
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
        campId: campId,
        CallStatus: { $ne: "completed" },
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
async function processEnhancedCampaign(campaignId, listData, fromNumber, wssUrl, clientId, listId) {
  let heartbeatActive = false;
  
  try {
    console.log(`🚀 Starting enhanced campaign: ${campaignId} with ${listData.length} contacts`);
    
    // Start heartbeat timer for container health monitoring
    const heartbeatResult = await startHeartbeat(campaignId);
    heartbeatActive = heartbeatResult.success;
    
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
      
      const contact = listData[i];
      
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
      const callResult = await processSingleCall({
        clientId,
        campaignId,
        from: fromNumber,
        to: contact.number,
        wssUrl,
        firstName: contact.first_name,
        tag: assistantId, // Use assistantId for NEW billing system
        listId,
        // Enhanced tracking for pause/resume
        contactIndex: i,                           // Position in list
        sequenceNumber: i + 1,                     // Sequence number (1-based)
        contactData: contact                       // Full contact data
      });
      
      // Track results and update campaign statistics
      if (callResult.success) {
        connectedCall++;
        console.log(`✅ Call ${i + 1}/${listData.length}: ${contact.number} (${callResult.callUUID})`);
      } else {
        failedCall++;
        console.error(`❌ Call ${i + 1}/${listData.length}: ${contact.number} - ${callResult.error}`);
      }
      
      // Update campaign position after processing this contact
      await updateCampaignProgress(campaignId, i + 1);
      
      callsInLastMinute++;
      
      // Update processed count and last activity  
      await updateCampaignActivity(campaignId, connectedCall + failedCall);
      
      // Wait between calls
      const subsequentWait = parseInt(process.env.SUBSEQUENT_CALL_WAIT) || 6000;
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
  return processEnhancedCampaign(campaignId, listData, fromNumber, wssUrl, clientId, listId);
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
    
    if (!["running", "paused"].includes(campaign.status)) {
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
      campaign.listId
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
      // Simple rule: mark campaign completed only when ringing == processed == ongoing == 0
      const activeCalls = counts.processed + counts.ringing + counts.ongoing;
      
      console.log(`🔍 DEBUG: activeCalls (processed + ringing + ongoing): ${activeCalls} (${counts.processed} + ${counts.ringing} + ${counts.ongoing})`);
      console.log(`🔍 DEBUG: call-ended: ${counts["call-ended"]}, completed: ${counts.completed}`);
      
      if (activeCalls > 0) {
        campaignStatus = 'running';  // Still has active calls
        console.log(`🔍 DEBUG: Status -> 'running' (${activeCalls} active calls remaining)`);
      } else {
        campaignStatus = 'completed';  // No active calls remaining
        console.log(`🔍 DEBUG: Status -> 'completed' (no active calls remaining)`);
      }
    } else {
      console.log(`🔍 DEBUG: Status kept as manual override: ${campaignStatus}`);
    }
    
    console.log(`🔥 CRITICAL BUG: Campaign ${campaignId} has ${totalRecords} total records, but all showing as 'completed': ${JSON.stringify(counts)}`);
    
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

    // Fetch all hangup data for test calls (campId = 'testcall')
    const hangupDataDocs = await hangupCollection.find({ 
      campId: 'testcall'
    }).sort({ createdAt: -1 }).toArray();

    if (hangupDataDocs.length === 0) {
      return { status: 404, message: "No test call data found." };
    }

    // Extract unique CallUUIDs from hangupData
    const callUUIDs = hangupDataDocs.map(doc => doc.CallUUID);

    // Fetch all logData documents based on CallUUIDs (contains bot callback data, lead analysis, etc.)
    const logDataDocs = await logCollection.find({ callUUID: { $in: callUUIDs } }).toArray();

    // Calculate total conversation time from hangup data (more accurate)
    const totalConversationTime = hangupDataDocs.reduce((sum, doc) => sum + (parseInt(doc.Duration) || 0), 0);

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
        RecordUrl: recordMap.get(hangupDoc.CallUUID) || null, // Attach RecordUrl if found
        callType: 'testcall' // Mark as test call for identification
      };
    });

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

  module.exports = {
    insertList,
    insertListContent,
    getListByClientId,
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
    // Enhanced campaign management functions
    cancelCampaign,
    pauseCampaign,
    resumeCampaign,
    getCampaignProgress,
    getCampaignState,
    processEnhancedCampaign
  }