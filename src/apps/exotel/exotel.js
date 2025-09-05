const { connectToMongo, closeMongoConnection, client } = require('../../../models/mongodb.js');

const { ObjectId } = require('mongodb'); 
const axios = require('axios');
const base64 = require('base-64');
// const request = require('request'); // Replaced with axios for security
const csv = require('csv-parser');
const fs = require('fs');
const cosineSimilarity = require('cosine-similarity');
const FormData = require('form-data');
require ('dotenv').config();
// const { Configuration, OpenAIApi } = require('openai');
const { AzureOpenAI } = require("openai");
const { zodResponseFormat } = require('openai/helpers/zod');
const { z, promise } = require('zod');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;


// const configuration = new Configuration({
//   apiKey: process.env.OPENAI_API_KEY,
// }); 
// const openai = new OpenAIApi(configuration);
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY // This is also the default, can be omitted
// });

const endpoint = process.env.AZURE_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;

const apiVersion = "2024-08-01-preview";
const deployment = "gpt-4o"; //This must match your deployment name.

const openaiClient = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

async function getEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002', // Use the appropriate model
      input: text,
      encoding_format: "float",
    });
    const embeddings = response.data[0].embedding;
    return embeddings;
  } catch (error) {
    console.error('Error getting embedding:', error);
    return null;
  }
}
const exotel_auth_key = process.env.EXOTEL_AUTH_KEY;
const exotel_auth_token = process.env.EXOTEL_AUTH_TOKEN;
const exotel_account_sid = process.env.EXOTEL_ACCOUNT_SID;
const exotel_phone_number = process.env.EXOTEL_PHONE_NUMBER;
const threshold = process.env.THRESHOLD;
async function makeCallViaCampaign(listSid, camp_name, clientId, balanceCount, retries, appId, callerNumber, isSchedule = 0){
    balanceCount = balanceCount/1003;
    const remainder = balanceCount%1003;
    if(remainder == 0 && balanceCount > 0){
      return { status: 501, message: "Chala jaa bhai nhi ho payega tumse." };
    }
    // let listSid = response.response.data.list.sid;
    // console.log(listSid);
    let responseFromCamp = '';
    // const data = {
    // 'name': camp_name,
    // 'caller_id': exotel_phone_number,
    // 'url': 'http://my.exotel.com/glimpass2/exoml/start_voice/808269',
    // 'from': ["+917061588225"]    
    // };
    // console.log(data)
    // const url = `https://api.exotel.com/v2/accounts/${exotel_account_sid}/campaigns`;
    // const authStr = `${exotel_auth_key}:${exotel_auth_token}`;
    // const authB64 = base64.encode(authStr);

    // const headers = {
    //     'Authorization': `Basic ${authB64}`,
    //     'Content-Type': 'application/json'
    // };
    retries.interval_mins = parseInt(retries.interval_mins)
    retries.number_of_retries = parseInt(retries.number_of_retries)
    listSid = Array.isArray(listSid) ? listSid : [listSid]
    let sendAt, endAt
    // if(isSchedule){
    //    sendAt = now.add(2, 'hours').toISOString();
    //    endAt = now.add(22, 'hours').toISOString();
    // }
      // schedule: [
                      //   {
                      //     send_at: sendAt,
                      //     end_at: endAt
                      //   }
                      // ],
    const makeExotelCall = async () => {
        const authStr = `${exotel_auth_key}:${exotel_auth_token}`;
        const authB64 = base64.encode(authStr);
        
        try {
            const response = await axios({
                method: 'POST',
                url: `https://api.exotel.com/v2/accounts/${exotel_account_sid}/campaigns`,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${authB64}`
                },
                data: {
                    campaigns: [
                        {
                            name: camp_name,
                            caller_id: callerNumber,
                            url: `http://my.exotel.com/glimpass2/exoml/start_voice/${appId}`,
                            lists: listSid,
                            call_status_callback: `${process.env.BASE_URL || 'https://application.glimpass.com'}/exotel/call-back-after-end`,
                            call_schedule_callback: `${process.env.BASE_URL || 'https://application.glimpass.com'}/exotel/call-back`,
                            retries: retries        
                        }
                    ]
                }
            });
            return response.data;
        } catch (error) {
            throw error;
        }
    };
    
    (async () => {
        try {
            responseFromCamp = await makeExotelCall();
            const parsedResponse = responseFromCamp;
		console.log(parsedResponse,parsedResponse.http_code)
            if (parsedResponse.response && parsedResponse.response.length > 0 &&  parsedResponse.http_code == 200) {
                const campaignId = parsedResponse.response[0].data.id;
                addCampaignDataInMongo(campaignId, responseFromCamp, clientId)
                const returnValue = await updateClientBalanceCount(camp_name, campaignId, balanceCount, clientId)
                if(!returnValue){
                  return {status : 500, message: "Call is in process but there is some error updating the balance"}
                }
            }
            else{
		    console.log(123, JSON.stringify(parsedResponse))
                return { status: 500, message: "Internal server error." };
            }
            console.log("Response from Exotel API:", responseFromCamp);
             return { status: 200, message: "call in progress" };
        } catch (error) {
            console.error("Error making call to Exotel API:", error);
            return { status: 500, message: "Internal server error." };
        }
    })();
}

async function addBillingHistoryInMongo(camp_name, clientId, balanceCount, date, campaignId, desc, transactionType, newAvailableBalance, paymentId = null, paymentProvider = null){
  try {
    await connectToMongo();

    // Perform MongoDB operations here using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("billingHistory");
     // Create the document to insert
     const billingHistoryDoc = {
      camp_name: camp_name,
      clientId: clientId,
      balanceCount: balanceCount,
      date: date,
      campaignId: campaignId,
      desc: desc,
      transactionType:transactionType,
      newAvailableBalance: newAvailableBalance,
      paymentId: paymentId,
      paymentProvider: paymentProvider
    };

    // Insert the document into the collection
    const result = await collection.insertOne(billingHistoryDoc);

    console.log(`New billing history inserted with _id: ${result.insertedId}`);
    if(result.insertedId){
      return {status: 200, message: 'billing created sucessfully'}
    } else{
      return { status: 500, message: "Internal server error." };
    }
  } catch(error) {
    console.error("Error running MongoDB queries:", error);
    return { status: 500, message: "Internal server error." };
  }
}
async function updateClientBalanceCount(camp_name, campaignId, balanceCount, clientId, report = false){
	try {
    await connectToMongo();
    // console.log('piyush', camp_name, campaignId, balanceCount, clientId, report)

    // Perform MongoDB operations here using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("client");
    const clientDocument = await collection.findOne({ _id: new ObjectId(clientId) });
    if (!clientDocument) {
      console.log("No document found with the provided clientId");
      return 0;
    }
    const date = new Date();
  
    let newAvailableBalance = clientDocument.availableBalance;
    let newBlockedBalance = 0;
    let camp = 0;
    if(report){
      newAvailableBalance = newAvailableBalance + (clientDocument.blockedBalance - balanceCount);
      camp = 0;
      let desc  = '';
      let transactionType = 'Cr'
      if((clientDocument.blockedBalance - balanceCount) > 0){
         desc = `Refunded: ${camp_name}`
      } else{
         transactionType = 'Dr'
         desc = `Additional Deduction: ${camp_name}`
      }
      const remainingBalance = (clientDocument.blockedBalance - balanceCount)
      addBillingHistoryInMongo(camp_name, clientId, remainingBalance, date, campaignId, desc, transactionType, newAvailableBalance)
      campaignId = ''
    } else{
      newAvailableBalance = newAvailableBalance - balanceCount;
      newBlockedBalance = newBlockedBalance + balanceCount;
      camp = 1;
      const desc = `Blocked: ${camp_name}`
      const transactionType = 'Dr'
      addBillingHistoryInMongo(camp_name, clientId, balanceCount, date, campaignId, desc, transactionType, newAvailableBalance)
    }

    const result = await collection.updateOne(
      { _id: new ObjectId(clientId) },
      { $set: { availableBalance: newAvailableBalance, blockedBalance: newBlockedBalance, isActiveCamp: camp, activeCampId: campaignId } }
    );

    if (result.matchedCount === 0) {
      console.log("No document found with the provided clientId");
      return 0;
    } else {
      console.log("Balances updated successfully");
      return 1;
    }
  } catch(error) {
    console.error("Error running MongoDB queries:", error);
    return 0;
  }
}
async function addCampaignDataInMongo(campaignId, responseFromCamp, clientId){
    try {
        await connectToMongo();
    
        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("campaign");
    
        await collection.insertOne({campaignId, responseFromCamp, clientId});
      } catch (error) {
        console.error("Error running MongoDB queries:", error);
      } finally {
	      // await closeMongoConnection();
      }
}
 async function createCampaign(clientId, camp_name){
    try {
        await connectToMongo();
    
        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("campaign");
    
          await collection.insertOne({clientId, camp_name});
          return { status: 200, message: `campaign created successfully.` };
      } catch (error) {
        console.error("Error running MongoDB queries:", error);
        return { status: 500, message: "Internal server error." };
      } finally {
       // await closeMongoConnection();
      }
 }

 async function createList(clientId, list_name, listSid, response, listSize){
    try {
        await connectToMongo();
    
        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("csvlist");
        // const listSize = response.listSize;
    
        await collection.insertOne({clientId, list_name, listSid, response, listSize});
        return { status: 200, message: `list created successfully.` };
      } catch (error) {
        console.error("Error running MongoDB queries:", error);
        return { status: 500, message: "Internal server error." };
      } finally {
      //  await closeMongoConnection();
      }
 }

 async function getCampaignByClientId(clientId){
    try {
        await connectToMongo();
    
        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("campaign");
    
        const campaignData = await collection.find({ clientId }).toArray();
        const reversedCampaignData = campaignData.reverse();
        if(reversedCampaignData)
          return reversedCampaignData;
        else
          return [];
      } catch (error) {
        console.error("Error running MongoDB queries:", error);
        return { status: 500, message: "Internal server error." };
      } finally {
       // await closeMongoConnection();
      }
 }
 async function getListByClientId(clientId){
    try {
        await connectToMongo();
    
        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("csvlist");
    
        const listData = await collection.find({ clientId }).toArray();
        const reversedListData = listData.reverse();
        if(reversedListData)
          return reversedListData;
        else
          return [];
      } catch (error) {
        console.error("Error running MongoDB queries:", error);
        return { status: 500, message: "Internal server error." };
      } finally {
       // await closeMongoConnection();
      }
 }

 async function getBillingHistoryByClientId(clientId){
  try {
    await connectToMongo();

    // Perform MongoDB operations here using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("billingHistory");

    // Find all billing history documents for the given clientId
    const billingHistory = await collection.find({ clientId: clientId }).toArray();
    const reversedbillingHistory = billingHistory.reverse();

    // DUPLICATE REMOVAL: Remove duplicate campaign billing entries
    // Look for text between ":" and "-" and check if campaign name + balance are same
    if (reversedbillingHistory && reversedbillingHistory.length > 0) {
      const deduplicatedHistory = [];
      const seenEntries = new Set();
      
      for (const entry of reversedbillingHistory) {
        // Extract campaign name from desc field (text between ":" and "-")
        let campaignKey = null;
        if (entry.desc && entry.desc.includes(':') && entry.desc.includes('-')) {
          const colonIndex = entry.desc.indexOf(':');
          const dashIndex = entry.desc.indexOf('-', colonIndex);
          if (dashIndex > colonIndex) {
            const campaignName = entry.desc.substring(colonIndex + 1, dashIndex).trim();
            // Create unique key: campaignName + newAvailableBalance
            campaignKey = `${campaignName}_${entry.newAvailableBalance}`;
          }
        }
        
        // If we extracted a campaign key, check for duplicates
        if (campaignKey) {
          if (!seenEntries.has(campaignKey)) {
            seenEntries.add(campaignKey);
            deduplicatedHistory.push(entry);
            console.log(`✅ Keeping billing entry: ${campaignKey}`);
          } else {
            console.log(`🗑️ Removing duplicate billing entry: ${campaignKey}`);
          }
        } else {
          // Non-campaign entries (incoming calls, payments, etc.) - keep all
          deduplicatedHistory.push(entry);
        }
      }
      
      console.log(`🔍 Billing deduplication: ${reversedbillingHistory.length} -> ${deduplicatedHistory.length} entries (removed ${reversedbillingHistory.length - deduplicatedHistory.length} duplicates)`);
      return deduplicatedHistory;
    }

    return reversedbillingHistory || [];

  } catch (error) {
    console.error("Error running MongoDB queries:", error);
    return { status: 500, message: "Internal server error." };
  } finally {
   // await closeMongoConnection();
  }
 }

 async function getCallBackAfterCall(response){
    try {
        await connectToMongo();
    
        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("temp");
    
          await collection.insertOne({response});
          return { status: 200, message: `campaign created successfully.` };
      } catch (error) {
        console.error("Error running MongoDB queries:", error);
        return { status: 500, message: "Internal server error." };
      } finally {
       // await closeMongoConnection();
      }
 }
 async function getCallBackAfterEachCallEnd(response){
    try {
        await connectToMongo();
    
        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("temp");
    console.log('call back after')
          await collection.insertOne({response});
          return { status: 200, message: `campaign created successfully.` };
      } catch (error) {
        console.error("Error running MongoDB queries:", error);
        return { status: 500, message: "Internal server error." };
    } finally {
       // await closeMongoConnection();
      }
 }

// async function getReportByCampaignId(campaignId, duration, prompt) {
//   const data = await getCampaignCallData(campaignId);
//   if (data) {
//       return data;
//   }

//   let totalDuration = 0;
//   const authStr = `${exotel_auth_key}:${exotel_auth_token}`;
//   const authB64 = Buffer.from(authStr).toString('base64');
//   const limit = 20; // Limit for Exotel API
//   let offset = 0;

//   const allResults = [];
//   const allLongCalls = [];

//   async function fetchPage(offset) {
//       const options = {
//           method: 'GET',
//           url: `https://api.exotel.com/v2/accounts/${exotel_account_sid}/campaigns/${campaignId}/call-details?sort_by=date_created:desc&limit=${limit}&offset=${offset}`,
//           headers: {
//               Authorization: 'Basic ' + authB64
//           }
//       };

//       const response = await axios(options);
//       return response.data;
//   }

//   while (true) {
//       try {
//           // Fetch data concurrently in batches
//           const singleResponse = await Promise.resolve(fetchPage(0))
//           const totalData = singleResponse.metadata.total;
//           let iteration = Math.floor(totalData/20);
//           console.log(totalData, iteration, ( ((totalData%20)> 0) ? 1 : 0))
//           iteration = iteration + (((totalData%20)> 0) ? 1 : 0)
//           const promises = [];
//           for (let i = 0; i < iteration; i++) { // Adjust 5 to increase/decrease batch size
//               promises.push(fetchPage(i * limit));
//           }
          
//           const responses = await Promise.all(promises);
// console.log('here =>', responses)
//           let hasMoreData = false;

//           for (const parsedResponse of responses) {
//               if (parsedResponse.response && parsedResponse.response.length > 0 && parsedResponse.http_code == 200) {
//                   const results = [];
//                   const longCalls = [];
//                   for (const data of parsedResponse.response) {
//                       let callData = data.data;
//                       callData.campaign_id = campaignId;
//                       const secondApiResponse = await callApiWithCallSid(callData.call_sid);
//                       if (secondApiResponse) {
//                           callData.chat = secondApiResponse.chat;
//                           callData.agent_id = secondApiResponse.agent_id;
//                           callData.log_duration = secondApiResponse.duration;
//                           totalDuration += secondApiResponse.duration;
//                       }
//                       addCampaignCallDataInMongo(callData);
//                       results.push(callData);
//                       if (callData.on_call_duration >= duration) {
//                           longCalls.push(callData);
//                       }
//                   }
// console.log(results)
//                   allResults.push(...results);
//                   allLongCalls.push(...longCalls);

//                   if (parsedResponse.response.length != limit) {
//                     hasMoreData = false;
//                   }
//                   if (parsedResponse.response.length === limit) {
//                       hasMoreData = true;
//                   }
//               }
//           }

//           if (!hasMoreData) {
//               break;
//           }

//           // offset += limit * 50; // Move to the next set of records
//       } catch (error) {
//           console.error('Error fetching data:', error);
//           break;
//       }
//   }

//   return allResults;
// }
async function getContactsFromList(listSid) {
  const authStr = `${exotel_auth_key}:${exotel_auth_token}`;
  const authB64 = Buffer.from(authStr).toString('base64');
  const url = `https://api.exotel.com/v2/accounts/${exotel_account_sid}/lists/${listSid}/contacts?offset=0&limit=5000`;

  const options = {
    method: 'GET',
    headers: {
      Authorization: 'Basic ' + authB64
    },
    url: url
  };

  try {
    const response = await axios(options);
    return response.data
  } catch (error) {
    console.error("Error fetching contacts:", error.message);
  }
}
async function getSingleCampaignDetails(campaignId) {
  const authStr = `${exotel_auth_key}:${exotel_auth_token}`;
  const authB64 = Buffer.from(authStr).toString('base64');
  const options = {
    method: 'GET',
    url: `https://api.exotel.com/v2/accounts/${exotel_account_sid}/campaigns/${campaignId}`,
    headers: {
      Authorization: 'Basic ' + authB64
    }  
  };
  try {
    const response = await axios(options);
    if(response.data.http_code == 200) {
      return response.data.response;
    }
  } catch (error) {
    console.error("Error fetching campaign details:", error);
  }
}
async function getReportByCampaignId(campaignId, duration, clientId, prompt, camp_name) {
  const status  = await getSingleCampaignDetails(campaignId)
  if(status[0].data.status != 'Completed'){
    return status[0].summary
  }
  // Check if data is already in MongoDB
  const data = await getCampaignCallData(campaignId);

  if (data.length != 0) {
      return data; // If data is found, return it
  }
  // If data is not found, return "data is processing" and start processing in the background
  processCampaignDataAsync(campaignId, duration, clientId, prompt, camp_name);
  return { status: "processing", message: "Data is being processed. Please try again later." };
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processCampaignDataAsync(campaignId, duration, clientId, prompt, camp_name) {
  let totalDuration = 0;
  let maxCallDuration = 0;
  let hotLead = 0;
  let warmLead = 0;
  let coldLead = 0;
  let avgDuration = 0;
  let failed = 0;
  let completed = 0;
  let date_created = null;
  const authStr = `${exotel_auth_key}:${exotel_auth_token}`;
  const authB64 = Buffer.from(authStr).toString('base64');
  const limit = 20;
  const batchSize = 100;

  const allResults = [];
  const allLongCalls = [];

  async function fetchPage(offset) {
    const options = {
      method: 'GET',
      url: `https://api.exotel.com/v2/accounts/${exotel_account_sid}/campaigns/${campaignId}/call-details?sort_by=date_created:desc&limit=${limit}&offset=${offset}`,
      headers: {
        Authorization: 'Basic ' + authB64
      }
    };
    const response = await axios(options);
    return response.data;
  }

  try {
    const singleResponse = await fetchPage(0);
    const totalData = singleResponse.metadata.total;
    let iteration = Math.ceil(totalData / limit);

    for (let i = 0; i < iteration; i += batchSize) {
      const batchPromises = [];
      for (let j = i; j < i + batchSize && j < iteration; j++) {
        batchPromises.push(fetchPage(j * limit));
      }

      // Fetch batch responses
      const responses = await Promise.all(batchPromises);
      const currentBatchData = [];

      // Collect all call data from the responses
      for (const parsedResponse of responses) {
        if (parsedResponse.response && parsedResponse.response.length > 0 && parsedResponse.http_code === 200) {
          for (const data of parsedResponse.response) {
            let callData = data.data;
            callData.campaign_id = campaignId;
            currentBatchData.push(callData);  // Store callData to process in bulk
          }
        }
      }

      // Fetch log data in bulk from MongoDB for all calls in the current batch
      const callSids = currentBatchData.map(call => call.call_sid);
      const logData = await fetchLogDataForCalls(callSids);

      // Process each callData and enrich with log data
      for (let callData of currentBatchData) {
        const logDataEntry = logData.find(log => log.call_sid === callData.call_sid);
        if (logDataEntry) {
          callData.chat = logDataEntry.chat;
          callData.agent_id = logDataEntry.agent_id;
          callData.objective_qualified_data = logDataEntry.structuredOutputData;
          if(logDataEntry.chat){
            hotLead += logDataEntry.structuredOutputData.hotLead;
            coldLead += logDataEntry.structuredOutputData.coldLead;
            warmLead += logDataEntry.structuredOutputData.warmLead;
          }
        }
        if(callData.status == 'completed'){
          completed++;
        } else {
          failed++;
        }
        date_created = callData.date_created
        totalDuration += (callData.on_call_duration / 2);
        maxCallDuration = Math.max(maxCallDuration, (callData.on_call_duration / 2))
        // Check if the call duration qualifies as a long call
        if (callData.on_call_duration >= duration) {
          allLongCalls.push(callData);
        }

        // Add to all results
        allResults.push(callData);
      }

      // Bulk insert all processed call data to MongoDB at once
      await addCampaignCallDataInMongoBulk(currentBatchData);

      // Wait for 60 seconds before processing the next batch
      if (i + batchSize < iteration) {
        console.log(`Processed ${i + batchSize} items, waiting for 20 seconds...`);
        await sleep(20000);
      }
    }
    avgDuration = totalDuration/totalData;
    await updateCampaignLeads(campaignId, hotLead, warmLead, coldLead, totalData, totalDuration, avgDuration, maxCallDuration, completed, failed, date_created)
    // Update client balance with the total duration after processing all batches
    await updateClientBalanceCount(camp_name, campaignId, totalDuration, clientId, true);
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

async function updateCampaignLeads(campaignId, hotLead, warmLead, coldLead, totalData, totalDuration, avgDuration, maxCallDuration, completed, failed, date_created) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("campaign");

    // Find the campaign document
    const campaignDocument = await collection.findOne({ campaignId:campaignId });
    if (!campaignDocument) {
      console.log("No campaign document found with the provided campaignId");
      return 0;
    }

    // Prepare the update object for hotLead, warmLead, and coldLead
    const update = {
      $set: {
        hotLead: hotLead,
        warmLead: warmLead,
        coldLead: coldLead,
        totalDuration: totalDuration,
        totalData: totalData,
        avgDuration: avgDuration,
        maxCallDuration: maxCallDuration, 
        completed: completed,
        failed: failed, 
        date_created: date_created
      }
    };

    // Update the campaign document with the new values
    const result = await collection.updateOne(
      { campaignId: campaignId },
      update
    );

    if (result.matchedCount === 0) {
      console.log("No campaign found with the provided campaignId");
      return 0;
    } else {
      console.log("Campaign leads updated successfully");
      return 1;
    }
  } catch (error) {
    console.error("Error running MongoDB queries:", error);
    return 0;
  }
}

async function getclientOverviewByCampId(campaignId, clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("campaign");

    let campaigns = [];

    // If "all campaign", retrieve all campaigns for the client
    if (campaignId === "all campaign") {
      campaigns = await collection.find({ clientId: clientId }).toArray(); 
    } else {
      // Retrieve data for the specific campaign
      const campaign = await collection.findOne({
        campaignId: campaignId,  // Using campaignId as string
        clientId: clientId       // Using clientId as string
      });
      if (campaign) {
        campaigns.push(campaign);
      }
    }

    if (campaigns.length === 0) {
      console.log("No campaigns found for the provided clientId or campaignId");
      return null;
    }

    // Initialize variables to accumulate the totals
    let totalHotLead = 0;
    let totalWarmLead = 0;
    let totalColdLead = 0;
    let totalData = 0;
    let totalDuration = 0;
    let avgDuration = 0;
    let maxCallDuration = 0;
    let completed = 0;
    let failed = 0;
    let date_created = 0;

    // Prepare an array to store individual campaign data
    let campaignDetails = [];

    // Loop through all campaigns and accumulate the values
    campaigns.forEach(camp => {
      totalHotLead += camp.hotLead || 0;
      totalWarmLead += camp.warmLead || 0;
      totalColdLead += camp.coldLead || 0;
      totalData += camp.totalData || 0;
      totalDuration += camp.totalDuration || 0;
      avgDuration += camp.avgDuration || 0;
      maxCallDuration += camp.maxCallDuration || 0;
      completed += camp.completed || 0;
      failed += camp.failed || 0;
      date_created = camp.date_created || null
      // Add individual campaign data to campaignDetails array
      campaignDetails.push({
        campaignId: camp.campaignId,
        hotLead: camp.hotLead || 0,
        warmLead: camp.warmLead || 0,
        coldLead: camp.coldLead || 0,
        totalData: camp.totalData || 0,
        totalDuration: camp.totalDuration || 0,
        avgDuration : camp.avgDuration || 0,
        maxCallDuration : camp.maxCallDuration || 0,
        completed : camp.completed || 0,
        failed : camp.failed || 0,
        date_created : camp.date_created || null
      });
    });

    const reversedCampaignDetails = campaignDetails.reverse();

    // Return individual campaign data and overall totals
    return {
      campaigns: reversedCampaignDetails, // All individual campaign data
      overall: {
        campaignId: campaignId === "all campaign" ? "all campaigns" : campaignId,
        hotLead: totalHotLead,
        warmLead: totalWarmLead,
        coldLead: totalColdLead,
        totalData: totalData,
        totalDuration: totalDuration,
        avgDuration : avgDuration,
        maxCallDuration : maxCallDuration,
        completed : completed,
        failed : failed,
        date_created : date_created
      }
    };

  } catch (error) {
    console.error("Error fetching campaign overview:", error);
    return null;
  }
}



async function fetchLogDataForCalls(callSids) {
  try {
    await connectToMongo();

    // Perform MongoDB operations using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("logData");

    // Query the logData collection for all callSids
    const logs = await collection.find({ call_sid: { $in: callSids } }).toArray();

    return logs;
  } catch (error) {
    console.error("Error fetching log data from MongoDB:", error);
    return [];
  } finally {
    // Optionally, close the connection here if needed
    // await closeMongoConnection();
  }
}

async function addCampaignCallDataInMongoBulk(callDataBatch) {
  try {
    await connectToMongo();

    // Perform MongoDB operations using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("campaignCallData");

    // Prepare bulk operations for each callData
    const bulkOps = callDataBatch.map(callData => {
      const filter = { call_sid: callData.call_sid };
      const update = { $setOnInsert: callData };
      const options = { upsert: true }; // Upsert ensures it inserts if not found
      return { updateOne: { filter, update, upsert: true } };
    });

    // Perform bulk write operation
    const result = await collection.bulkWrite(bulkOps);

    console.log(`Bulk operation completed. Inserted: ${result.upsertedCount}, Matched: ${result.matchedCount}`);
  } catch (error) {
    console.error("Error performing bulk MongoDB operations:", error);
  } finally {
    // Optionally, close the connection here if needed
    // await closeMongoConnection();
  }
}

 async function addCampaignCallDataInMongo(callData){
    try {
        await connectToMongo();
    
        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("campaignCallData");
        const filter = { call_sid: callData.call_sid };
        const update = { $setOnInsert: callData };

        const options = { upsert: true }; // upsert: true ensures that it inserts if not found
        const result = await collection.updateOne(filter, update, options);
      } catch (error) {
        console.error("Error running MongoDB queries:", error);
      } finally {
       // await closeMongoConnection();
      }
}

// async function getCampaignCallData(campaign_id){
//   try{
//     await connectToMongo();
//     const database = client.db("talkGlimpass");
//     const collection = database.collection("campaignCallData");

//     const campaignData = await collection.find({ "campaign_id": campaign_id, "lastData": 1 }).toArray();
//     const allCampaignData = await collection.find({ "campaign_id": campaign_id }).toArray();
//     if(campaignData.length > 0){
//       return allCampaignData;
//     }else{
//       return [];
//     }
//   }catch (error) {
//     console.error("Error running MongoDB queries:", error)
//   } finally{
//  //   await closeMongoConnection();
//   }
// }

async function getCampaignCallData(campaign_id, chat = false) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("campaignCallData");

    // Build the query object dynamically based on the `chat` parameter
    const query = { 
      "campaign_id": campaign_id 
    };

    if (chat) {
      query["chat"] = { $exists: true }; // Add chat existence check if chat is true
    }

    const campaignData = await collection.find({ 
      ...query, 
      "lastData": 1 
    }).toArray();

    const allCampaignData = await collection.find(query).toArray();

    if (allCampaignData.length > 0) {
      return allCampaignData;
    } else {
      return [];
    }
  } catch (error) {
    console.error("Error running MongoDB queries:", error);
    return [];
  } finally {
    // Uncomment if you want to close the MongoDB connection after the operation
    // await closeMongoConnection();
  }
}

const callApiWithCallSid = async (callSid, prompt) => {
  try {
    // Construct the data object
    let data = { callSid: callSid };
    
    // Add OQprompt only if prompt is not empty
    if (prompt) {
      data.OQprompt = prompt;
    }
    
    // Make the API request
    const response = await axios.post('https://ivrus.glimpass.com/get-log-data', data, {
      headers: {
        'Accept': 'application/json, text/plain, */*', // Fixing the Accept header
        'Content-Type': 'application/json',
      }
    });
    
    // Return the data from the response
    return response.data;
  } catch (error) {
    // console.error('Error calling API:', error.message); // Use error.message for more concise logging
    throw error; // Re-throw the error after logging it
  }
};




const processCsvFile = async(filePath, buffer, listName, from_number, callback) => {
  const results = [];
  await connectToMongo();
  const database = client.db("talkGlimpass");
  const collection = database.collection("initialCallData");
  const stream = buffer ? stream.PassThrough() : fs.createReadStream(filePath);
  if (buffer) stream.end(buffer);

  stream
    .pipe(csv())
    .on('data', (data) => { data.from_number = from_number
	    results.push(data)})
    .on('end', () => {
      // Process the CSV data here
      if (!validateCsvFormat(results)) {
        return callback('Invalid CSV format.', null);
      }
      console.log(results);
      collection.insertMany(results)
      sendToApi(results, filePath, listName, (err, response) => {
        if (err) {
          return callback(err, null);
        }
        response.listSize = results.length
      // Delete the file if it was saved on disk
      if (filePath) {
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error('Error deleting file:', err);
            callback('Error processing file.', null);
          } else {
            callback(null, response);
          }
        });
      } else {
        callback(null, response);
      }
    });
  });
};

const validateCsvFormat = (data) => {
  if (data.length === 0) return false;
  const expectedHeaders = ['number', 'first_name', 'last_name', 'company_name', 'email', 'tag', 'custom_field'];

  // Check if the headers in the data match the expected headers
  let headers = Object.keys(data[0]);
	headers= headers.slice(0,7)
	console.log(headers)
  if (!expectedHeaders.every(header => headers.includes(header))) {
    return false;
  }

  // Check if each row has values for at least one of the required fields
  return data.every(row => expectedHeaders.some(header => row[header] !== ''));
};

// Function to create a CSV
async function createCsv(number, first_name) {
  return new Promise((resolve, reject) => {
      const filePath = `./${Date.now()}-first_name.csv`;

      const csvWriter = createCsvWriter({
          path: filePath,
          header: [
              { id: 'number', title: 'number' },
              { id: 'first_name', title: 'first_name' },
              { id: 'last_name', title: 'last_name' },
              { id: 'company_name', title: 'company_name' },
              { id: 'email', title: 'email' },
              { id: 'tag', title: 'tag' },
              { id: 'custom_field', title: 'custom_field' }
          ]
      });

      const data = [
          {
              number: number || '',
              first_name: first_name || '',
              last_name: '',
              company_name: '',
              email: '',
              tag: '',
              custom_field: ''
          }
      ];

      csvWriter.writeRecords(data)
          .then(() => resolve(filePath))
          .catch((err) => reject(err));
  });
}

async function scheduleCallViaCampaign(number, first_name, clientId, callerNumber, appId) {
  let response;
  const list_name = `piyush-${Date.now()}`
  // const appId = "867849"
  // const callerNumber = "07949121161"
  const camp_name = 'hotel_call'
  const retries = {
    "number_of_retries": 1,
    "interval_mins": 1,
    "mechanism": "Exponential",
    "on_status": [
    "failed",
    "busy"
    ]
    }
  try{
  const filePath = await createCsv(number, first_name)
  // const buffer = fs.readFileSync(filePath);

  response = await new Promise((resolve, reject) => {
    processCsvFile(filePath, '', list_name, (error, result) => {
        if (error) {
            return reject(error); // Throw error if processCsvFile fails
        }
        resolve(result);
    });
  });

  // Step 4: Clean up the temporary file
  fs.unlink(filePath, (err) => {
      if (err) {
          console.error('Error deleting file:', err);
      } else {
          console.log(`Temporary file ${filePath} deleted.`);
      }
  });
  } catch (error) {
  console.error('Error scheduling call via campaign:', error);
  throw error; // Propagate the error
  }
  console.log(response.response.data.list.sid, 'ram->')
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  await sleep(5000).then(() => console.log("End after 5 seconds"));
  const result = await makeCallViaCampaign(response.response.data.list.sid, camp_name, clientId, 0, retries, appId, callerNumber, 1);
  return response; // Return the response
}
// Legacy unirest implementation removed for security

const sendToApi = async (data, filePath, listName, callback) => {
  console.log(listName)
  const authStr = `${exotel_auth_key}:${exotel_auth_token}`;
  const authB64 = base64.encode(authStr);

  const form = new FormData();
  form.append('file_name', fs.createReadStream(filePath));
  form.append('list_name', listName);
  form.append('type', 'static');
  const config = {
    headers: {
      'Authorization': `Basic ${authB64}`,
      'Content-Type': 'application/json',
      ...form.getHeaders(),
    },
  };
  try {
    const response = await axios.post(`https://api.exotel.com/v2/accounts/${exotel_account_sid}/contacts/csv-upload`, form, config);
    callback(null, response.data);
  } catch (error) {
    callback(error.response ? error.response.data : error.message, null);
  }
};
async function storeAudioDataNew(sentence, agent_id, audio_data)
{
  try{
    storeAudioData(sentence, agent_id, audio_data);
    return {status: 200, message: 'audio data with embedding stored'};
  } catch(err)
  {
    return {status: 500, message: 'error running query'};
  }
}
async function storeAudioData(sentence, agent_id, audio_data){
  try{
  await connectToMongo();
  const embedding =  await getEmbedding(sentence)
  const database = client.db("talkGlimpass");
  const collection = database.collection("audioData");
  const filter = { sentence: sentence };
  const update = { $setOnInsert: {sentence, agent_id, audio_data, embedding} };
  const options = { upsert: true }; // upsert: true ensures that it inserts if not found
  const result =  await collection.updateOne(filter, update, options);
  return {status: 200, message: 'audio data with embedding stored'};
  } catch(error) {
    return {status: 500, message: 'error running query'};
  }
}

async function getAudioData(sentence, agent_id){
  try{
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("audioData");
    const embedding = await getEmbedding(sentence);
    if (!embedding) return null;
    const docs = await collection.find({agent_id}).toArray();
    const similarityPromises = docs.map(async (doc) => {
      const similarity = cosineSimilarity(embedding, doc.embedding);
      return { doc, similarity };
    });
  
    const similarities = await Promise.all(similarityPromises);
    let bestMatch = null;
    let highestSimilarity = -1;

    similarities.forEach(({ doc, similarity }) => {
      if (similarity > highestSimilarity && similarity > threshold) {
        highestSimilarity = similarity;
        bestMatch = doc;
      }
    });

    return bestMatch ? bestMatch.audio_data : null;

  } catch( error){
    console.log('error')
  }
}

async function getObjectiveQualifiedLead(campaignId, prompt) {
  const campData = await getCampaignCallData(campaignId, true);
  const batchSize = 500; // Process 100 requests at a time
  let qualifiedLeads = [];

  for (let i = 0; i < campData.length; i += batchSize) {
    const batch = campData.slice(i, i + batchSize);
    const promises = batch.map(data => isObjectiveQualifiedLead(data.chat, prompt));
    const responses = await Promise.all(promises);

    const batchQualifiedLeads = responses
      .map((response, index) => ({
        ...batch[index],
        isQualified: response.isQualified,
        explanation: response.explanation
      }))
      .filter(response => response.isQualified === 1);

    qualifiedLeads = qualifiedLeads.concat(batchQualifiedLeads);
  }

  return qualifiedLeads;
}

const qualifiedLeadSchema  = z.object({
  isQualified: z.number(),
  explanation: z.string()
})
async function isObjectiveQualifiedLead(chat, prompt){
  try {
    const response = await openai.beta.chat.completions.parse({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: `You are a world renowned data analyst known for your exceptional data analysis skills.
         Your job is to do the following task:
        1. check the OBJECTIVE to understand what the user wants
        2. look at a chat between an AI and a customer and understand the full conversation
        3. Finally, give a json of response with two keys :
        a. explanation : explain why the given CHAT should or should not be returned to the user based on what user wants. 
        b. isQualified : output True if the CHAT is what the user wants and False otherwise
        
        NOTE: If the conversation is too short isQualified is always False. SO make sure that there is enough conversation to tell anything.
        IMPORTANT: The chat between human and AI is divided by a pipe '|' so the human answer is for the question just before the pipe. So Isqualified will only be true if the person's positive answer is just after the question just before the answer.` },
        { role: 'user', content: `following is the CHAT between an AI and a customer and OBJECTIVE given by user:
        1. CHAT: ${chat}
        2. OBJECTIVE: ${prompt}` },
      ],
      response_format: zodResponseFormat(qualifiedLeadSchema, "structuredData"),
    });

    const structuredData = response.choices[0].message;

    return structuredData.parsed;
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to analyze chat and parse structured data.');
  }
}

const qualifiedLeadTypeSchema  = z.object({
  hotLead: z.number(),
  coldLead: z.number(),
  warmLead: z.number(),
  explanation: z.string(),
  whatsappMessage:z.number(),
  name: z.string(),
  detailedSummary: z.string(),
  problem: z.string(),
  notSure: z.string(),
  hotLead1: z.number(),
  coldLead1: z.number(),
  warmLead1: z.number(),
})
async function getQualifiedLeadType(chat, prompt, campDetails){
  try {
    if(!campDetails|| campDetails == null){
      campDetails.hotCond = 'After analyzing the whole chat, output True if the chat shows the customer is ready to make a purchase or take immediate action, and False otherwise.'
      campDetails.warmCond = 'After analyzing the whole chat, output True if the chat shows little to no interest or engagement from the customer, indicating no immediate need or purchase intent, and False otherwise.'
    }
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: 'system', content: `You are a world renowned data analyst known for your exceptional data analysis skills.
         Your job is to do the following task:
        1. check the OBJECTIVE to understand what the user wants
        2. look at a chat between an AI and a customer and understand the full conversation
        3. Finally, give a json of response with nine keys :
        a. explanation : explain why the given CHAT should or should not be returned to the user based on what user wants. 
        b. hotLead: It will be hot lead if it fullfills any of the following conditions ${campDetails.hotCond}
        c. warmLead: It will be warm lead if it fullfills any of the following conditions ${campDetails.warmCond}
        d. coldLead: After analyzing the whole chat, output True if the chat shows little to no interest or engagement from the customer, indicating no immediate need or purchase intent, and False otherwise.
        e. notSure: True if the lead type (hot, cold, warm) is unclear or uncertain, voicemail and machine detection. False otherwise.
        e. whatsappMessage: Output true if user has asked to send whatsapp message, and false otherwise
        f. name: Extract the customer's name if it's present in the chat otherwise name will be an empty string.
        g  detailedSummary: "Given the past conversation summary, add any important information from the current chat. Remember to not remove any information from the past summary, you can compact it, the new summary must show a story of the user's entire history. In case there is no summary summarize the chat in 3rd person:- the user's name, age (if mentioned), gender (if mentioned), and problem or request and response described during the conversation."
        h  problem: "Summary of the user's primary issue, request, or symptoms described.it should consists of one sentence"
        i. hotLead1: After analyzing the whole chat, output True if the chat shows the customer is ready to make a purchase or take immediate action, and False otherwise.
        j. coldLead1: After analyzing the whole chat, output True if the chat shows little to no interest or engagement from the customer, indicating no immediate need or purchase intent, and False otherwise.
        k. warmLead:1 After analyzing the whole chat, output True if the chat shows interest and engagement but without immediate purchase intent, indicating the customer needs more time or information, and False otherwise
        NOTE: If the conversation is too short isQualified is always False. SO make sure that there is enough conversation to tell anything.
        IMPORTANT: The chat between human and AI is divided by a pipe '|' so the human answer is for the question just before the pipe. So Isqualified will only be true if the person's positive answer is just after the question just before the answer.` },
        { role: 'user', content: `following is the CHAT between an AI and a customer and OBJECTIVE given by user:
        1. CHAT: ${chat}
        2. OBJECTIVE: ${prompt}` },
      ],
      response_format: zodResponseFormat(qualifiedLeadTypeSchema, "structuredData"),
    });
    const structuredData = response.choices[0].message;
    return structuredData.content;
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to analyze chat and parse structured data.');
  }
}

async function saveLogData(data) {
  try {
    await connectToMongo();
    const prompt = {True: 'given the objective, if the response of the user is positive', False: 'given the objective, if the response of the user is not positive'};
    // Format the chat from messages array
    if (data.messages && Array.isArray(data.messages)) {
      data.chat = data.messages.map(msg => {
        if (msg.role === "assistant") {
          return `AI: ${msg.content}`;
        } else if (msg.role === "user") {
          return `human: ${msg.content}`;
        }
        return '';
      }).join(' | ');
    }
    if(data.chat){
      let prevData = [];
      if(data.caller_number && data.ai_number){
         prevData = await getPreviousLogData(data.caller_number, data.ai_number)
      }
      let chatData  = data.chat
      if(prevData && prevData.structuredOutputData && JSON.parse(prevData.structuredOutputData).detailedSummary){
        chatData = "Here is the current user's conversation: \n" + chatData + "\n here is the summary of the user's previous conversations: \n" +JSON.parse(prevData.structuredOutputData).detailedSummary;
      }
      let campDetails = null
      if(data.campId){
       campDetails = await getPlivoCampaignDetails(data.campId)
      }
      const structuredData =  await getQualifiedLeadType(chatData, prompt, campDetails)
      data.structuredOutputData = structuredData
    }

    data.caller = data.caller_number
    data.exophone = data.ai_number
    // Perform MongoDB operations here using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("logData");
    const result = await collection.insertOne(data);
    
    if (result.insertedId) {
      return { status: 200, message: 'Log saved successfully' };
    } else {
      return { status: 500, message: "Internal server error while saving data." };
    }
  } catch (error) {
    console.error("Error running MongoDB queries:", error);
    return { status: 500, message: "Error saving log data." };
  } finally {
    // await closeMongoConnection();
  }
}

async function getPlivoCampaignDetails(camp_id) {
  try{
    await connectToMongo();
  
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");

    // Handle special campaign IDs like 'testcall', 'incoming' that aren't ObjectIds
    let campaignData;
    if (camp_id === 'testcall' || camp_id === 'incoming' || camp_id === 'undefined') {
      // For special campaign types, return empty array (no campaign details needed)
      campaignData = [];
    } else if (camp_id && camp_id.match && camp_id.match(/^[0-9a-fA-F]{24}$/)) {
      // Valid ObjectId format
      campaignData = await collection.find({_id: new ObjectId(camp_id)}).toArray();
    } else {
      // Invalid or missing camp_id
      campaignData = [];
    }

    return campaignData;
  } catch (error) {
    console.error("Error fetching lists:", error);
    return [];
  }
}

async function getPreviousLogData(from_number, to_number) {
  try {
    const database = client.db("talkGlimpass");
    const collection = database.collection("logData");

    // Query to find data based on from_number and to_number
    const query = {
      caller: from_number,
      exophone: to_number
    };

    const result = await collection
    .find(query)
    .sort({ _id: -1 })
    .limit(1)           
    .toArray();

    // Check if data is found
    if (result.length > 0) {
     return result[0];
    } else {
      return [];
    }
  } catch (error) {
    console.error("Error fetching data:", error);
    return { status: 500, message: "Internal server error." };
  }
}


async function getLogDataByCallSid(callSid) {
  try {
    await connectToMongo(); // Assuming you have a function to connect to MongoDB

    const database = client.db("talkGlimpass");
    const collection = database.collection("logData");

    // Query the logData collection for a document with the specified CallSid
    const logData = await collection.findOne({ call_sid: callSid });

    if (!logData) {
      console.log("No log data found for the provided CallSid");
      return null;
    }

    // Return the retrieved log data
    return logData;
  } catch (error) {
    console.error("Error retrieving log data:", error);
    return null;
  }
}



async function getLogData(from, to){
  try{
    await connectToMongo(); // Assuming you have a function to connect to MongoDB

    const database = client.db("talkGlimpass");
    const collection = database.collection("logData");

        const normalizePhoneVariants = (num) => {
      const variants = new Set();

      if (num.length === 12 && num.startsWith("91")) {
        variants.add(num); // 91XXXXXXXXXX
        variants.add("0" + num.slice(2)); // 0XXXXXXXXXX
        variants.add(num.slice(2)); // XXXXXXXXXX
      } else if (num.length === 11 && num.startsWith("0")) {
        variants.add(num); // 0XXXXXXXXXX
        variants.add("91" + num.slice(1)); // 91XXXXXXXXXX
        variants.add(num.slice(1)); // XXXXXXXXXX
      } else if (num.length === 10) {
        variants.add(num); // XXXXXXXXXX
        variants.add("91" + num); // 91XXXXXXXXXX
        variants.add("0" + num); // 0XXXXXXXXXX
      } else {
        variants.add(num); // fallback: original value
      }

      return Array.from(variants);
    };

    const fromVariants = normalizePhoneVariants(from);
    const toVariants = normalizePhoneVariants(to);

    // Query the logData collection for a document with the specified CallSid
       const logData = await collection
      .find({
        caller: { $in: fromVariants },
        exophone: { $in: toVariants }
      })
      .sort({ _id: -1 })
      .limit(1)
      .toArray();
    if (!logData || logData.length == 0) {
      let initialCallData = await getInitialCallData(from, to)
      initialCallData.name = initialCallData.first_name
      return initialCallData
    }
    let finalLogData = JSON.parse(logData[0].structuredOutputData)
    finalLogData.lead_analysis = logData[0].lead_analysis
    finalLogData.summary = logData[0].summary
    // Return the retrieved log data
    return finalLogData
  } catch (error) {
    console.error("Error retrieving log data:", error);
    return null;
  }
}

async function getInitialCallData(from, to) {
  try{
    await connectToMongo(); // Assuming you have a function to connect to MongoDB

    const database = client.db("talkGlimpass");
    const collection = database.collection("initialCallData");

    // Query the logData collection for a document with the specified CallSid
    const logData = await collection.find({from_number: to , number: from}).sort({ _id: -1 }).limit(1).toArray()

    return logData[0]
  } catch (error) {
    console.error("Error retrieving log data:", error);
    return null;
  }
}


 async function  addIncomingCallData(data) {
  try {
    await connectToMongo();

    // Perform MongoDB operations here using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("campaignCallData");
    data.callType = 'incoming'
    const result = await collection.insertOne(data);
    if(result.insertedId){
      return {status: 200, message: 'incoming call data saved sucessfully'}
    } else{
      return { status: 500, message: "Internal server error." };
    }
  } catch (error) {
    console.error("Error running MongoDB queries:", error);
  } finally {
   // await closeMongoConnection();
  }
 }

 async function mergeCampaignAndLogData(phoneNumber, secured_demo) {
  try {
    // Connect to MongoDB
    await connectToMongo();
    const database = client.db("talkGlimpass");

    // Get the campaignCallData collection
    const campaignCallDataCollection = database.collection("campaignCallData");

    // Find all campaignCallData records using the phone number
    const campaignCallDataList = await campaignCallDataCollection.find({ 
      To: phoneNumber, 
      callType: 'incoming' 
    }).toArray();


    if (campaignCallDataList.length === 0) {
      return { status: 404, message: "No campaign call data found for this phone number." };
    }

    // Extract all unique call_sid values
    const callSids = campaignCallDataList.map(data => data.CallSid);

    // Get the logData collection
    const logDataCollection = database.collection("logData");
    const assistantCollection = database.collection("assistant");
    let appId = null;
    // Fetch all logData records that match the call_sids using a single query
    const logDataList = await logDataCollection.find({ call_sid: { $in: callSids } }).toArray();

    // Create a map of logData for faster lookup by call_sid
    const logDataMap = logDataList.reduce((map, logData) => {
      map[logData.call_sid] = logData;
      return map;
    }, {});

    // Merge campaignCallData with corresponding logData
    // const mergedDataList = campaignCallDataList.map( async (campaignCallData) => {
    //   const logData = logDataMap[campaignCallData.CallSid] || {}; // Get logData if exists, else empty object
    //   console.log(logData.agent_id)
    //   if(!appId && logData.agent_id){
    //     const assistantDataList = await assistantCollection.find({ _id: new ObjectId(logData.agent_id)}).toArray();
    //     console.log(assistantDataList," ram aam khata hai")
    //     appId = assistantDataList[0].appId
    //     logData.app_id = appId
    //   } else{
    //     logData.app_id = appId
    //   }
    //   console.log(campaignCallData, logData)
    //   return {
    //     ...campaignCallData,
    //     ...logData, // Merge logData fields
    //   };
    // });

    const mergedDataList = await Promise.all(
      campaignCallDataList.map(async (campaignCallData) => {
        const logData = logDataMap[campaignCallData.CallSid] || {}; // Get logData if exists, else empty object
       if(secured_demo == 1){
        if (!appId && logData.agent_id) {
          // Fetch assistant data from database
          const assistantDataList = await assistantCollection
            .find({ _id: new ObjectId(logData.agent_id) })
            .toArray();
          
    
          // Ensure assistantDataList is not empty
          if (assistantDataList.length > 0) {
            appId = assistantDataList[0].appId;
            logData.app_id = appId;
          }
        } else {
          logData.app_id = appId;
        }
       }
    
        console.log(campaignCallData, logData);
    
        return {
          ...campaignCallData,
          ...logData, // Merge logData fields
        };
      })
    );
    
    const reversedmergedDataList = mergedDataList.reverse();
    // Return the merged data
    return reversedmergedDataList

  } catch (error) {
    console.error("Error merging data:", error);
    return { status: 500, message: "Internal server error." };
  }
}


async function  createCustomer(data) {
  try {
    await connectToMongo();

    // Perform MongoDB operations here using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("customer");
    const result = await collection.insertOne(data);
    if(result.insertedId){
      return {status: 200, message: 'incoming call data saved sucessfully'}
    } else{
      return { status: 500, message: "Internal server error." };
    }
  } catch (error) {
    console.error("Error running MongoDB queries:", error);
    return { status: 500, message: "Internal server error." };
  } finally {
   // await closeMongoConnection();
  }
 }
 async function fetchCustomerByClient(clientId){
  try{
    await connectToMongo(); // Assuming you have a function to connect to MongoDB

    const database = client.db("talkGlimpass");
    const collection = database.collection("customer");

    // Query the logData collection for a document with the specified CallSid
    const customerData = await collection.find({clientId: clientId }).toArray()
    if (!customerData) {
      console.log("No Customer data found for the provided CallSid");
      return null;
    }
    return customerData
  } catch (error) {
    console.error("Error retrieving log data:", error);
    return null;
  }
}
 

module.exports = {updateClientBalanceCount, getBillingHistoryByClientId, scheduleCallViaCampaign,  getLogData, createCustomer, fetchCustomerByClient, getLogDataByCallSid, getclientOverviewByCampId, mergeCampaignAndLogData, addIncomingCallData, saveLogData, addBillingHistoryInMongo, getContactsFromList, getSingleCampaignDetails, getObjectiveQualifiedLead, callApiWithCallSid, makeCallViaCampaign,getCallBackAfterEachCallEnd, storeAudioDataNew, getAudioData, processCsvFile, getReportByCampaignId, createCampaign, getCampaignByClientId, getListByClientId, createList, getCallBackAfterCall}
