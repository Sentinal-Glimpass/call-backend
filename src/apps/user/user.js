const db = require("../../../models/db.js");

    
async function findNearestEntity(nodeID, type = 'washroom') {
    try {
        const aqlQuery = `
            LET nearestWashroom = (
                FOR v, e, p IN 1..7
                ANY @startNodeId
                GRAPH nodeGraph
                FILTER v.nodeType == @type
                LET floorChangeSteps = SUM(
                    FOR node IN p.vertices
                    RETURN node.nodeWeight
                )  // Calculate total additional steps for floor changes
                LET totalStep = SUM(p.edges[*].steps) + floorChangeSteps  // Calculate total step count
                SORT totalStep
		LIMIT 1
                RETURN v
            )
            RETURN nearestWashroom[0]
       `;
        const cursor = await db.query(aqlQuery, { startNodeId: nodeID, type: type});
        const result = await cursor.next();
        if (result) {
            return result
        } else {
            return { status: 409, message: `no ${type} found`};
        }
    } catch (error) {
        return { status: 409, message: error.message };
    }
}

async function registerUser(userData){
    const aqlQuery = `
    UPSERT @condition
    INSERT @data
    UPDATE { updatedAt: DATE_NOW() } IN users
    RETURN { "user": NEW, "operation": (OLD ? "update" : "insert") }
  `;
   const bindVars = {
    condition: {email: userData.email},
    data: userData
   }
   try {
    const cursor = await db.query(aqlQuery, bindVars);
    const result = await cursor.all();
    return result;
  } catch (err) {
    console.error('Failed to execute upsert:', err);
    throw err;
  }
}

async function userLogin(email){
    const aqlQuery = `
    FOR user IN users
        FILTER user.email == @targetEmail
        RETURN user
    `;
    const bindVars = { targetEmail: email };
    try{
        const cursor = await db.query(aqlQuery, bindVars);
        const results = await cursor.all();
        return results.length > 0 ? results[0] : false;
    } catch(err) {
        throw err;
    }
}

async function storeFeedbackOfUser(userId, feedback){
    const feedbackCollection = db.collection("feedback");

    try {
      // Create a new feedback document
      const feedbackDocument = {
        userId: userId,
        content: feedback,
        timestamp: new Date().toISOString(),
      };
  
      // Insert the feedback document into the collection
      const result = await feedbackCollection.save(feedbackDocument);
      console.log(result._key);
      return { status: 201, message: `Graph created sucessfully.` };
    } catch (error) {
      console.error("Failed to store feedback:", error);
      return { status: 409, message: `There is problem in storing feedback` };
    }
}

async function getAllDataOfMarketFloorWise(floor, market){
    console.log(floor,market);
    const query = `
        LET nodesOnFloor = (
            FOR node IN nodes
                FILTER node.floor == ${floor} and node.market == @market
                RETURN node
        )

        LET nodeIdsOnFloor = nodesOnFloor[*]._id

        LET roadsOnFloor = (
            FOR road IN roads
                FILTER (road._from IN nodeIdsOnFloor) AND (road._to IN nodeIdsOnFloor)
                RETURN road
        )

        RETURN {
            nodes: nodesOnFloor,
            roads: roadsOnFloor
        }
    `;
    const bindVars = {
        market
    }
    try {
        const cursor = await db.query(query,bindVars);
        const res =  await cursor.all();
        return res[0];
    } catch (error) {
        console.error('Error executing query:', error);
        return { status: 409, message: error };
    }
}

module.exports = {findNearestEntity,registerUser,userLogin, storeFeedbackOfUser, getAllDataOfMarketFloorWise};
