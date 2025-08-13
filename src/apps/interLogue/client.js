const { connectToMongo, closeMongoConnection, client } = require('../../../models/mongodb.js');

const { ObjectId } = require('mongodb'); 
const axios = require('axios');

async function insertClient(clientData) {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("client");
  
      if (clientData._id) {
        // If _id exists, update the document
        const filter = { _id: new ObjectId(clientData._id) };
        delete clientData._id; // Remove _id from the data to be updated
        const updateResult = await collection.updateOne(filter, { $set: clientData });
        if (updateResult.modifiedCount > 0) {
          return { status: 200, message: `Client updated successfully.` };
        } else {
          return { status: 404, message: `Client not found for update.` };
        }
      } else {
        // If _id doesn't exist, insert a new document
        await collection.insertOne(clientData);
        return { status: 201, message: `Client created successfully.` };
      }
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
      return { status: 500, message: "Internal server error." };
    } finally {
      // await closeMongoConnection();
    }
  }
  


async function insertAssistant(assistantData) {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("assistant");
  
      // Example: Insert a document
      const result = await collection.insertOne(assistantData);
  
      // Example: Find documents
    //   const documents = await collection.find({}).toArray();
    //   console.log("Documents:", documents);
      return { status: 201,id: result.insertedId };
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      // await closeMongoConnection();
    }
  }

  async function insertSession(sessionData) {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("session");
  
      // Example: Insert a document
      await collection.insertOne(sessionData);
  
    //   // Example: Find documents
    //   const documents = await collection.find({}).toArray();
    //   console.log("Documents:", documents);
      return { status: 201, message: `session created sucessfully.` };
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      // await closeMongoConnection();
    }
  }
// async function insertUsers(userDataArray) {
//   try {
//     await connectToMongo();

//     // Perform MongoDB operations here using the client object
//     const database = client.db("talkGlimpass");
//     const collection = database.collection("users");

//     // Insert multiple documents
//     await collection.insertMany(userDataArray);

//     return { status: 201, message: 'Users created successfully.' };
//   } catch (error) {
//     console.error("Error running MongoDB queries:", error);
//     return { status: 500, message: 'Error creating users.' };
//   } finally {
//     await closeMongoConnection();
//   }
// }

async function insertUsers(userDataArray, isUpdate) {
  try {
    await connectToMongo();

    // Perform MongoDB operations here using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("users");

    if (isUpdate) {
      // Update all documents in userDataArray based on number and name
      const bulkOps = userDataArray.map(user => {
	let callAgain = true;
	if(user.endedAt){      
            callAgain = (user.endedAt - user.startedAt) < 3; // Check the timing key
        }
        const { _id, ...updateData } = user;
        return {
          updateOne: {
		  filter: {_id: new ObjectId(user._id)},
            update: { 
              $set: { 
                ...updateData,
                callAgain 
              } 
            },
            upsert: false
          }
        };
      });
//	          console.log("Bulk Operations:", JSON.stringify(bulkOps, null, 2));

//	    console.log(bulkOps);

      // Execute bulk operations
     const result =  await collection.bulkWrite(bulkOps);
//	    console.log("Bulk Write Result:", JSON.stringify(result, null, 2), result.modifiedCount);
      if (result.modifiedCount === 0) {
        return { status: 400, message: 'No users were updated. Check if the filter criteria match existing documents.' };
      }
      return { status: 200, message: 'Users updated successfully.' };
    } else {
      // Insert all documents in userDataArray
      await collection.insertMany(userDataArray);
      return { status: 201, message: 'Users created successfully.' };
    }
  } catch (error) {
    console.error("Error running MongoDB queries:", error);
    return { status: 500, message: 'Error creating or updating users.' };
  } finally {
    // await closeMongoConnection();
  }
}

  async function insertUser(userData) {
    try {
      await connectToMongo();

      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("users");

      // Example: Insert a document
      await collection.insertOne(userData);

    //   // Example: Find documents
    //   const documents = await collection.find({}).toArray();
    //   console.log("Documents:", documents);
      return { status: 201, message: `session created sucessfully.` };
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      // await closeMongoConnection();
    }
  }
  async function insertStaff(staffData) {
    try {
      await connectToMongo();

      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("staffs");

      // Example: Insert a document
      await collection.insertOne(staffData);

    //   // Example: Find documents
    //   const documents = await collection.find({}).toArray();
    //   console.log("Documents:", documents);
      return { status: 201, message: `session created sucessfully.` };
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      // await closeMongoConnection();
    }
  }
   async function insertIvrLog(staffData) {
    try {
      await connectToMongo();

      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("ivr-call-data");

      // Example: Insert a document
      await collection.insertOne(staffData);

    //   // Example: Find documents
    //   const documents = await collection.find({}).toArray();
    //   console.log("Documents:", documents);
      return { status: 201, message: `log created sucessfully.` };
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      // await closeMongoConnection();
    }
  }
  async function getClient(email, password) {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("client");
  
      // Find client and validate credentials
      const clientData = await collection.findOne({ email, password });
      
      if (clientData) {
        // Initialize tokens if not present (for existing users)
        if (typeof clientData.tokens === 'undefined') {
          await collection.updateOne(
            { _id: clientData._id },
            { 
              $set: { 
                tokens: 100, // Give existing users 100 free tokens
                isActive: true,
                createdAt: new Date(),
                tokenHistory: []
              }
            }
          );
          clientData.tokens = 100;
          clientData.isActive = true;
        }
        
        // Remove sensitive fields before returning
        const {
          password: pwd,
          internalNotes,
          ...safeClientData
        } = clientData;
        
        return safeClientData;
      } else {
        return null;
      }
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
      throw error;
    } finally {
      // await closeMongoConnection();
    }
  }
  async function getAllClients() {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("client");
  
      // Example: Find documents
      const clientData = await collection.find().toArray();
      if(clientData)
        return clientData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      // await closeMongoConnection();
    }
  }
  async function getAssistant(unicode) {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("assistant");
  
      // Example: Find documents
      const assistantData = await collection.findOne({ unicode });
      console.log(assistantData)
      if(assistantData)
        return assistantData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
     // await closeMongoConnection();
    }
  }

  async function getAssistantDetails(assistantId) {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("assistant");
  
      // Example: Find documents
      const assistantData = await collection.findOne({_id: new ObjectId(assistantId) });
      if(assistantData)
        return assistantData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
     // await closeMongoConnection();
    }
  }

//  async function getAssistantByClientId(clientId, isClient)
//   {
// 	  try {
//       await connectToMongo();

//       // Perform MongoDB operations here using the client object
//       const database = client.db("talkGlimpass");
//       const collection = database.collection("assistant");

//       // Example: Find documents
//       //const assistantData = await collection.findOne({ clientId });
//       const assistantData = await collection.find({ clientId: clientId }).toArray();
//       if(assistantData)
//         return assistantData;
//       else
//         return [];
//     } catch (error) {
//       console.error("Error running MongoDB queries:", error);
//     } finally {
//       await closeMongoConnection();
//     }

//   }

async function getAssistantByClientId(clientId, isClient) {
  try {
    await connectToMongo();

    const database = client.db("talkGlimpass");
    const collection = database.collection("assistant");

    let assistantData;

    if (isClient === 1) {
      // Fetch documents and include all fields
      assistantData = await collection.find({ clientId: clientId }).toArray();

      if (assistantData.length > 0) {
        // Modify the documents to exclude the payload field and include extracted fields
        return assistantData.map((doc) => {
          const { payload, ...rest } = doc; // Exclude payload key
          
          // Extract agent_welcome_message and system_prompt from payload
          const agent_welcome_message = payload?.agent_config?.agent_welcome_message || '';
          const system_prompt = payload?.agent_prompts?.task_1?.system_prompt || '';

          // Return the modified document with agent_welcome_message and system_prompt
          return {
            ...rest,
            agent_welcome_message,
            system_prompt
          };
        });
      } else {
        return [];
      }
    } else {
      // For isClient != 1, return the full documents including payload
      assistantData = await collection.find({ clientId: clientId }).toArray();
      return assistantData || [];
    }
  } catch (error) {
    console.error("Error running MongoDB queries:", error);
    return [];
  } finally {
   // await closeMongoConnection();
  }
}

  async function getSession(clientId) {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("session");
      // Example: Find documents
      const sessionData = await collection.findOne({ clientId });
      if(sessionData)
        return sessionData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
     // await closeMongoConnection();
    }
  }

  async function getStaff(staffId) {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("staffs");
  
      // Example: Find documents
      const staffData = await collection.findOne({ staffId });
     // console.log(assistantData)
      if(staffData)
        return staffData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      //await closeMongoConnection();
    }
  }

  async function getUser(userId) {
    try {
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("users");
  
      // Example: Find documents
      const userData = await collection.findOne({ userId });
     // console.log(userData)
      if(userData)
        return userData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      //await closeMongoConnection();
    }
  }
 async function getStaffByClientId(clientId)
  {
          try {
      await connectToMongo();

      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("staffs");

      // Example: Find documents
      //const assistantData = await collection.findOne({ clientId });
      const staffData = await collection.find({ clientId: clientId }).toArray();
      if(staffData)
        return staffData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      //await closeMongoConnection();
    }

  }
 async function getUserByClientId(clientId, callingNumber = false)
  {
          try {
      await connectToMongo();

      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("users");

      // Example: Find documents
      //const userData = await collection.findOne({ clientId });
      let userData = [];
      if(callingNumber){
         userData = await collection.find({ clientId: clientId, callAgain: callingNumber}).toArray();
      } else{
         userData = await collection.find({ clientId: clientId }).toArray();
      }
      if(userData)
        return userData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      // await closeMongoConnection();
    }

  }

async function getUserByStaffId(staffId)
  {
          try {
      await connectToMongo();

      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("users");

      // Example: Find documents
      //const userData = await collection.findOne({ staffId });
      const userData = await collection.find({ staffId: staffId }).toArray();
      if(userData)
        return userData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
      // await closeMongoConnection();
    }

  }

async function getIvrLog() {
    try {
         await connectToMongo();

        // Perform MongoDB operations here using the client object
        const database = client.db("talkGlimpass");
        const collection = database.collection("ivr-call-data");

        // Fetch all documents as an array
        const callData = await collection.find({}).toArray();
        return callData;
    } catch (error) {
        console.error("Error running MongoDB queries:", error);
        return []; // Return an empty array to indicate no data or an error
    } finally {
        if (client) {
            // await closeMongoConnection(client);
        }
    }
}
  async function getAllAssistants() {
    try {
	    console.log(343)
      await connectToMongo();
  
      // Perform MongoDB operations here using the client object
      const database = client.db("talkGlimpass");
      const collection = database.collection("assistant");
  
      // Example: Find documents
      const clientData = await collection.find().toArray();
      if(clientData)
        return clientData;
      else
        return [];
    } catch (error) {
      console.error("Error running MongoDB queries:", error);
    } finally {
    //  await closeMongoConnection();
    }
  }


// async function updateAssistant(assistantId, newDocs, isClient) {
//   try {
//     await connectToMongo();

//     const database = client.db("talkGlimpass");
//     const collection = database.collection("assistant");

//     const filter = { _id: new ObjectId(assistantId) };

//     // If isClient is 1, update specific fields in the existing document
//     if (isClient == 1) {
//       const existingDoc = await collection.findOne(filter);
//       if (!existingDoc) {
//         return { status: 404, message: `Document with _id: ${assistantId} not found` };
//       }

//       // Update the agent_welcome_message inside agent_config
//       if (newDocs.agent_welcome_message && existingDoc.agent_config) {
//         existingDoc.agent_config.agent_welcome_message = newDocs.agent_welcome_message;
//       }

//       // Update the system_prompt inside agent_prompts.task_1
//       if (newDocs.system_prompt && existingDoc.agent_prompts && existingDoc.agent_prompts.task_1) {
//         existingDoc.agent_prompts.task_1.system_prompt = newDocs.system_prompt;
//       }

//       // Update the document in the database with the modified fields
//       const result = await collection.updateOne(filter, {
//         $set: {
//           "agent_config.agent_welcome_message": existingDoc.agent_config.agent_welcome_message,
//           "agent_prompts.task_1.system_prompt": existingDoc.agent_prompts.task_1.system_prompt
//         }
//       });

//       if (result.matchedCount > 0) {
//         return { status: 200, message: `Successfully updated the document with _id: ${assistantId}` };
//       } else {
//         return { status: 404, message: `No documents matched the query. Document with _id: ${assistantId} not found` };
//       }
//     } else {
//       // If isClient is not 1, replace the document with newDocs
//       newDocs._id = new ObjectId(assistantId); // Ensure the new document has the correct _id
//       const result = await collection.replaceOne(filter, newDocs);

//       if (result.matchedCount > 0) {
//         return { status: 200, message: `Successfully replaced the document with _id: ${assistantId}` };
//       } else {
//         return { status: 404, message: `No documents matched the query. Document with _id: ${assistantId} not found` };
//       }
//     }
//   } catch (error) {
//     console.error("Error running MongoDB queries:", error);
//     return { status: 500, message: "Internal Server Error", error };
//   }
// }


async function updateAssistant(assistantId, newDocs, isClient) {
  try {
    await connectToMongo();

    const database = client.db("talkGlimpass");
    const collection = database.collection("assistant");

    const filter = { _id: new ObjectId(assistantId) };

    // If isClient is 1, update specific fields in the existing document
    if (isClient == 1) {
      const existingDoc = await collection.findOne(filter);
      if (!existingDoc) {
        return { status: 404, message: `Document with _id: ${assistantId} not found` };
      }

      // Update the agent_welcome_message inside agent_config
      if (newDocs.agent_welcome_message && existingDoc.payload.agent_config) {
        existingDoc.payload.agent_config.agent_welcome_message = newDocs.agent_welcome_message;
      }

      // Update the system_prompt inside agent_prompts.task_1
      if (newDocs.system_prompt && existingDoc.payload.agent_prompts && existingDoc.payload.agent_prompts.task_1) {
        existingDoc.payload.agent_prompts.task_1.system_prompt = newDocs.system_prompt;
      }

      // Update the document in the database with the modified fields
      const result = await collection.updateOne(filter, {
        $set: {
          "payload.agent_config.agent_welcome_message": existingDoc.payload.agent_config.agent_welcome_message,
          "payload.agent_prompts.task_1.system_prompt": existingDoc.payload.agent_prompts.task_1.system_prompt
        }
      });

      if (result.matchedCount > 0) 
         return { status: 200, message: `Successfully updated the document.` };
      else 
         return { status: 404, message: `No documents matched the query. Document with _id: ${assistantId} not found` };

      // if (result.matchedCount > 0) {
      //   // Prepare the payload for the POST request
      //   const updatePayload = {
      //     agent_config: { ...existingDoc.payload.agent_config, agent_id: assistantId },
      //     agent_prompts: existingDoc.payload.agent_prompts,
      //     agent_id: assistantId,
      //   };

      //   // Make the POST request to the given URL using axios
      //   try {
      //     const response = await axios.post('https://ivrsp.glimpass.com/agent', updatePayload, {
      //       headers: {
      //         'Content-Type': 'application/json'
      //       }
      //     });

      //     // Check if the POST request was successful
      //     if (response.status === 200) {
      //       return { status: 200, message: `Successfully updated the document and made a POST request.` };
      //     } else {
      //       return { status: 500, message: `Document updated, but POST request failed with status: ${response.status}` };
      //     }
      //   } catch (axiosError) {
      //     console.error("Error with POST request:", axiosError);
      //     return { status: 500, message: `Document updated, but POST request failed.`, error: axiosError };
      //   }
      // } else {
      //   return { status: 404, message: `No documents matched the query. Document with _id: ${assistantId} not found` };
      // }
    } else {
      // If isClient is not 1, replace the document with newDocs
      newDocs._id = new ObjectId(assistantId); // Ensure the new document has the correct _id
      const result = await collection.replaceOne(filter, newDocs);

      if (result.matchedCount > 0) {
        return { status: 200, message: `Successfully replaced the document with _id: ${assistantId}` };
      } else {
        return { status: 404, message: `No documents matched the query. Document with _id: ${assistantId} not found` };
      }
    }
  } catch (error) {
    console.error("Error running MongoDB queries:", error);
    return { status: 500, message: "Internal Server Error", error };
  }
}



async function updateClient(clientId, newDocs) {
  try {
  await connectToMongo();

  // Perform MongoDB operations here using the client object
  const database = client.db("talkGlimpass");
  const collection = database.collection("client");

   const filter = { _id: new ObjectId(clientId) };
   newDocs._id = new ObjectId(clientId)
  const result = await collection.replaceOne(filter, newDocs);

 if (result.matchedCount > 0) {
        return { status: 200, message: `Successfully replaced the document with _id: ${clientId}` };
    } else {
      return { status: 200, message: `No documents matched the query. Document with _id: ${clientId} was not found.` };

    }
} catch(error){
console.error("Error running MongoDB queries:", error);
}
}

async function getClientByClientId(clientId){
  try {
    await connectToMongo();
  
    // Perform MongoDB operations here using the client object
    const database = client.db("talkGlimpass");
    const collection = database.collection("client");
  
    const filter = { _id: new ObjectId(clientId) };
    const result = await collection.findOne(filter);
  
   if (result) {
      return result;
   } else {
      return [];
   }
  } catch(error){
  console.error("Error running MongoDB queries:", error);
  }
}
module.exports = {updateAssistant,getAssistantDetails, getClientByClientId, updateClient, getAllAssistants,getAssistantByClientId,insertIvrLog,getIvrLog,getAllClients,  getStaff, getUser, getStaffByClientId, getUserByClientId, getUserByStaffId, insertUser, insertStaff,  insertClient, insertAssistant, insertSession, getClient, getAssistant, getSession, insertUsers}
