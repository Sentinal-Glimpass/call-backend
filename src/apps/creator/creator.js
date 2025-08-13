// main.js

const db = require("../../../models/db.js");

async function createConnectionBetweenNodes(node1, relation, node2, tripId) { 
    let nodeOneId,nodeTwoId;
    relation.tripId = tripId;
    if(node1.nodeId){
      nodeOneId = node1.nodeId;
    }else{
      node1.createdAt = Date.now();
      node1.updatedAt = Date.now();
      node1.tripId = tripId;
      const condition1 = {name: node1.name, floor: node1.floor, market: node1.market};
      const n1 = await upsertNode(node1, condition1);
      nodeOneId = n1[0].key;
    }
    if(node2.nodeId){
      nodeTwoId = node2.nodeId;
    }else{
      node2.createdAt = Date.now();
      node2.updatedAt = Date.now();
      node2.tripId = tripId;
      const condition2 = {name: node2.name, floor: node2.floor, market: node2.market};
      const n2 = await upsertNode(node2, condition2);
      nodeTwoId = n2[0].key;
    }
    await insertRelationIfNotExist(nodeOneId, nodeTwoId, relation);
    if( node1.floorDirection != 1){
      relation.angle = Math.abs((relation.angle + 180)%360);
      await insertRelationIfNotExist(nodeTwoId, nodeOneId, relation);
    }
}


async function upsertNode(data, condition, collectionName = "nodes") {
  let aqlQuery = `
    UPSERT @condition
    INSERT @data
    UPDATE MERGE(OLD, @data, { updatedAt: DATE_NOW() }) IN ${collectionName}
    RETURN { "key": NEW._id, "operation": (OLD ? 
      "update" : "insert") }
  `;
  // if(data.shop_angle){
  //   aqlQuery = `
  //     UPSERT @condition
  //     INSERT @data
  //     UPDATE { updatedAt: DATE_NOW(), shop_angle: ${data.shop_angle} } IN ${collectionName}
  //     RETURN { "key": NEW._id, "operation": (OLD ? 
  //       "update" : "insert") }
  //    `;
  // }

  const bindVars = {
    condition: condition,
    data: data, 
  };
  try {
    const cursor = await db.query(aqlQuery, bindVars);
    const result = await cursor.all();
    return result;
  } catch (err) {
    console.error('Failed to execute upsert:', err);
    throw err;
  }
}

async function insertRelationIfNotExist(nodeOne, NodeTwo, relation){
    
    // Check if the relationship already exists
    const existingRelation = await db.query(`
    FOR relation IN roads
    FILTER relation._from == @nodeOne AND relation._to == @NodeTwo
    RETURN relation
    `, {
    nodeOne,
    NodeTwo
    });
    const results = await existingRelation.all();
    if (results.length === 0) {
        relation._from = nodeOne;
        relation._to = NodeTwo;
        await db.collection('roads').save(relation);
    } else {
        console.log('The relationship already exists!');
    }
}

async function createGraphInArangoDB(tripData){
    let lengthOfTripArray = tripData.length;
    let sucess = 1;
    const tripName = tripData[0].name+'-'+tripData[lengthOfTripArray-1].name; 
    const market = tripData[0].market;
    const creatorId = "creators/14134512";
    const tripHistoryData = {
      tripName: tripName,
      market: market,
      creatorId: creatorId,
      createdAt: Date.now()
    };
    const condition = {tripName: tripName, market: market, createdAt: Date.now()};
    const trip = await upsertNode(tripHistoryData, condition, 'tripHistory');
    const tripId = trip[0].key;
    if(lengthOfTripArray < 3){
      return { status: 409, message: `There is some issue in creation of graph` };
    }
    for(let i=0;i<lengthOfTripArray; i=i+2){
        if(i+2>= lengthOfTripArray)
          break;
        if(tripData[i].nodeType === 'floor_change'){
          if(i+3 >= lengthOfTripArray){
            break;
          }
          try{
            if(tripData[i+2].nodeType === 'checkpoint'){
              await createConnectionBetweenNodes(tripData[i], tripData[i+3], tripData[i+4],tripId);
              i = i+2;
            } else{
              await createConnectionBetweenNodes(tripData[i], tripData[i+1], tripData[i+2],tripId);
            }
          } catch(err){
              console.log('error in creating graph',err.message);
              sucess = 0;
              break;
          }
        }
        else{
          try{
            await createConnectionBetweenNodes(tripData[i], tripData[i+1], tripData[i+2],tripId);
          } catch(err){
              console.log('error in creating graph',err.message);
              sucess = 0;
              break;
          }
        }
    }
    if(sucess)
      return { status: 201, message: `Graph created sucessfully.` };
    else{
        return { status: 409, message: `There is some issue in creation of graph` };
    }
}
async function getAllNodesDataByMarket(market){
  const query = `FOR node IN nodes
  FILTER node.nodeType != "checkpoint" and node.market == @market
  RETURN node
  `;
  const bindVars = {
   market: market
  };
  let res;
  try{
  const cursor = await db.query(query, bindVars);
  res = await cursor.all();
  }catch(err){
    console.log(err);
  }

  // const finalResult = res.reduce((acc, item) => {
  //   acc[item.nodeId] = item;
  //   return acc;
  // }, {});
  const finalResult = await formatNodeResult(res);
  return finalResult;
}

async function getAllNodesData(){
  const query = `FOR node IN nodes
  FILTER node.nodeType != "checkpoint"
  RETURN node
  `;
  let res;
  try{
    const cursor = await db.query(query);
    res = await cursor.all();
  }catch(err){
	  console.log(err)
    console.log(err.message); 
  }
  // const finalResult = res.reduce((acc, item) => {
  //   acc[item._id] = item;
  //   return acc;
  // }, {});
  const finalResult = await formatNodeResult(res);
  return finalResult;
}

async function formatNodeResult(finalResult){
  const finalData = [];
  const nodeKeys = ['_id', 'name', 'nearBy', 'hiddenName', 'floor', 'nodeType', 'nodeSubType', 'category', 'market', 'floorDirection', 'shop_angle', 'subType'];
  for(let i=0; i< finalResult.length; i++) {
    const formattedData = {};
    formattedData['nodeId'] = finalResult[i]._id;
    formattedData['name'] = finalResult[i].name;
    formattedData['nearBy'] = finalResult[i].nearBy ?? null;
    formattedData['altNode'] = finalResult[i].hiddenName ?? null;
    formattedData['floor'] = finalResult[i].floor;
    formattedData['nodeType'] = finalResult[i].nodeType;
    formattedData['subType'] = finalResult[i].nodeSubType ?? null;
    formattedData['category'] = finalResult[i].category ?? null;
    formattedData['market'] = finalResult[i].market;
    formattedData['floorDirection'] = finalResult[i].floorDirection;
    formattedData['shop_angle'] = finalResult[i].shop_angle;
    formattedData['entryType'] = finalResult[i].subType ?? null;

    const objKeys = Object.keys(finalResult[i]);
    const notPresentKeys = objKeys.filter(key => !nodeKeys.includes(key));
    for(let j=0;  j< notPresentKeys.length; j++){
      const key = notPresentKeys[j];
      formattedData[key] = finalResult[i][key];
    }
    finalData.push(formattedData);
  }
  return finalData;
}
// async function getAllNodesWithCheckPoint(){
//   const query = `FOR node IN nodes
//   RETURN {nodeId: node._id, name: node.name, floor: node.floor, nodeType: node.nodeType, subType: node.nodeSubType}
//   `;
//   const cursor = await db.query(query);
//   const res = await cursor.all();

//   const finalResult = res.reduce((acc, item) => {
//     acc[item.nodeId] = item;
//     return acc;
//   }, {});
//   return finalResult;
// }

async function getShortestPath(startNodeId, endNodeId){
  const query = `
  FOR v, e IN OUTBOUND SHORTEST_PATH
    @startNodeId TO @endNodeId
    GRAPH nodeGraph
    OPTIONS {weightAttribute: "steps"}
    RETURN { vertices: {nodeId: v._id, name: v.name, floor: v.floor, nodeType: v.nodeType, subType: v.nodeSubType, nodeWeight: v.nodeWeight},
     edges: {relationId: e._id, angle: e.angle, steps: v.nodeWeight + e.steps} }
  `;
  const bindVars = {
    startNodeId: startNodeId,
    endNodeId: endNodeId
  };
  try{
  const cursor = await db.query(query, bindVars);
  const res = await cursor.all();
  const finalResult = await formatPathData(res);
  return finalResult;
  } catch(err){
    return { status: 409, message: err.message };
  }
}

async function getShortestPathSteps(startNodeId, endNodeId){
  const query = ` FOR v, e IN OUTBOUND SHORTEST_PATH
                  @startNodeId TO @endNodeId
                  GRAPH nodeGraph
                  OPTIONS {weightAttribute: "steps"}
                  LET pathDetails = (FOR vert, edg IN OUTBOUND SHORTEST_PATH
                                    @startNodeId TO @endNodeId
                                    GRAPH  nodeGraph
                                    OPTIONS {weightAttribute: "steps"}
                                    RETURN {
                                      vertex: vert,
                                      edge: edg
                                    })
                  LET totalSteps = SUM(FOR p IN pathDetails FILTER p.edge != null RETURN TO_NUMBER(p.edge.steps))
                  RETURN { 
                    totalSteps: totalSteps
                  }
                `
  const bindVars = {
    startNodeId: startNodeId,
    endNodeId: endNodeId
  };

  try{
    const cursor = await db.query(query, bindVars);
    const res = await cursor.next();
    return res.totalSteps;
    } catch(err){
      return 0;
    }
}

async function formatPathData(result){
  let finalResult = [];
  for(let i=0; i<result.length; i++){
    if(i===0){
      finalResult.push(result[i].vertices)
    } else{
      finalResult.push(result[i].edges)
      finalResult.push(result[i].vertices)
    }
  }
  return finalResult;
}

async function getbeasideNodesAtOneDepth(startNodeId, targetDepth = 1){
  try {
    // const query = `
    //   FOR v, e, p IN @targetDepth OUTBOUND @startNodeId
    //   GRAPH nodeGraph
    //   FILTER LENGTH(p.edges) == @targetDepth && v.nodeType != 'checkpoint'
    //   COLLECT uniqueNode = v WITH COUNT INTO count
    //   RETURN uniqueNode
    // `;
    const query = `FOR v, e, p IN @targetDepth OUTBOUND @startNodeId
          GRAPH nodeGraph
          FILTER LENGTH(p.edges) == @targetDepth
          COLLECT uniqueNode = v, uniqueEdges = p.edges WITH COUNT INTO count
          RETURN {node: uniqueNode, edges: uniqueEdges}
          `;

    const bindVars = {
      startNodeId,
      targetDepth
    };

    const cursor = await db.query(query, bindVars);
    const result = await cursor.all();
    const finalResult = await formatBesidesData(result);
    return finalResult;
  } catch (error) {
    return { status: 409, message: err.message };
  }
} 

async function formatBesidesData(result){
  let finalResult = [];
  for(let i=0; i<result.length; i++){
    let nodeData = result[i].node;
    if(result[i].edges){
      nodeData['edgeId'] = result[i].edges[0]['_id'];
      nodeData['steps'] = result[i].edges[0]['steps'];
      nodeData['angle'] = result[i].edges[0]['angle'];
    }
    finalResult.push(nodeData)
  }
  return finalResult;
}
async function deleteTripData(tripId){
  const nodeResult = await deleteNodeFromCollection(tripId, 'nodes');
  const roadResult = await deleteNodeFromCollection(tripId, 'roads');
  if(nodeResult == 1 && roadResult == 1){
    return { status: 201, message: `graph deleted sucessfully.` }; 
  }else{
    return { status: 409, message: `There is some issue in deletion of graph` };
  }
}

async function deleteNodeFromCollection(tripId, collectionName){
    const query = `
    FOR doc IN ${collectionName}
    FILTER doc.tripId == @targetTripId
    REMOVE doc IN ${collectionName}
    RETURN OLD
    `;
    const bindVars = { 
      targetTripId: tripId,
      collectionName: collectionName
    };
    db.query(query, bindVars)
    .then(() => {
      console.log('Documents with tripId', targetTripId,'and collectionName', collectionName, 'deleted successfully.');
      return 1;
    }) 
    .catch((error) => {
      console.error('Error deleting documents in collectionName',collectionName, error);
      return 0;
    });
}
async function getTripDataByMarket(market){
  const query = `
    FOR doc IN tripHistory
    FILTER doc.market == @targetMarket
    RETURN doc
  `;
  const bindVars = {
    targetMarket: market
  }
  try{
    const cursor = await db.query(query, bindVars);
    const res = await cursor.all();
    return res;
    } catch(err){
      return { status: 409, message: err.message };
    }
}

async function createNodesInArango(nodesData){
  let notInsertedNodes = [];
  for(let i=0; i<nodesData.length; i++){
    const formattedData = await createAndFormatNodesData(nodesData[i]);
    notInsertedNodes.push(formattedData);
  }

  if(notInsertedNodes[0].length === 0){
    return { status: 201, message: `Nodes inserted sucessfully.` };
  } else{
    return {status: 409, message: ` please insert these nodes ${notInsertedNodes} once again`};
  }
}

async function createAndFormatNodesData( nodesData ){
  let notInsertedNodes = [];
  let mainNodeName, mainNodeAltName, mainNode;
  for(let i=0; i<nodesData.nodeNames.length; i++){
    if( i === 0){
      mainNodeName = nodesData.nodeNames[i];
      mainNodeAltName = nodesData.nodeAltName[i];
      const nodeObj = {
        nodeId : nodesData.nodeId,
        market : nodesData.market,
        name : nodesData.nodeNames[i],
        nodeType: nodesData.nodeType,
        floorDirection : nodesData.floorDirection,
        floor : parseInt(nodesData.floor),
        shop_angle : nodesData.shopAngle,
        hiddenName : nodesData.nodeAltName[i],
	imageUrl : nodesData.imageUrl,
      }
      const res = await createNode(nodeObj);
      if(!res){
        notInsertedNodes.push(nodesData.nodeNames);
        return notInsertedNodes;
      }
      mainNode = res; 
    } else{
      const nodeObj = {
        nodeId : nodesData.nodeId,
        market : nodesData.market,
        name : nodesData.nodeNames[i],
        nodeType: nodesData.nodeType,
        floorDirection : nodesData.floorDirection,
        floor : parseInt(nodesData.floor),
        shop_angle : nodesData.shopAngle,
        hiddenName : nodesData.nodeAltName[i],
        nearBy : mainNode,
	imageUrl : nodesData.imageUrl,
      }
      const res = await createNode(nodeObj);
      if(!res){
        notInsertedNodes.push(nodeObj.name+' mainNode: '+mainNodeName);
      }
    }
  }
  return notInsertedNodes;
}

async function createNode(nodeData){
  try{
    let isMultiEntry = null;
    if(nodeData.name != nodeData.hiddenName){
       isMultiEntry = await checkAndUpdateDoc(nodeData.name, nodeData.floor, nodeData.market); 
    }
    if(isMultiEntry){
      nodeData.subType = 'multi_entry';
    }
    nodeData.createdAt = Date.now();
    nodeData.updatedAt = Date.now();
    let condition1 = {hiddenName: nodeData.hiddenName, floor: nodeData.floor, market: nodeData.market};
    if(nodeData.nodeId){
      condition1 = {_id : nodeData.nodeId}
    }
    delete nodeData.nodeId;
    const n1 = await upsertNode(nodeData, condition1);
    return n1[0].key;
  } catch(error){
     console.log(err);
     return 0;
  }
}

async function checkAndUpdateDoc(name, floor, market) {
  try {
    const collection = db.collection('nodes');
    const existingDocument = await findDocumentByName( name, floor, market );
    if (existingDocument) {
      existingDocument.subType = 'multi_entry'; 

      await collection.update(existingDocument._key, existingDocument);
      return 1;
    } else {
      return 0; // Document doesn't exist
    }
  } catch (error) {
    console.error("Error updating document:", error);
    return 0; // Handle any errors
  }
}

async function findDocumentByName(name, floor, market) {
  // const collection = db.collection('nodes');
  // try {
  //   const result = await collection.firstExample(example);
  //   return result;
  // } catch (error) {
  //   if (error.code === 404) {
  //     return null; // Return null if no match is found
  //   }
  //   console.error("Error finding document:", error);
  //   return null;
        const query = `
        FOR doc IN nodes
        FILTER doc.name == @name AND doc.floor == @floor AND doc.market == @market
        LIMIT 1
        RETURN doc
      `;

      const bindVars = {
        "name": name,
        "floor": floor,
        "market": market
      };

      try {
        const cursor = await db.query(query, bindVars);
        const result = await cursor.all();
        return result.length > 0 ? result[0] : null;
      } catch (error) {
        console.error('Error finding document:', error);
        throw error;
      }
}

// async function findNearestNode(nodeID, destinationNodeName){
//   try {
//       const aqlQuery = `
//           LET nearestNode = (
//               FOR v, e, p IN 1..8
//               ANY @startNodeId
//               GRAPH nodeGraph
//               FILTER v.name == @destinationNodeName
//               LET floorChangeSteps = SUM(
//                   FOR node IN p.vertices
//                   RETURN node.nodeType == 'floor_change' ? 10 : 0
//               )  // Calculate total additional steps for floor changes
//               LET totalStep = SUM(p.edges[*].steps) + floorChangeSteps  // Calculate total step count
//               SORT totalStep
//               LIMIT 1
//               RETURN v
//           )
//           RETURN nearestNode[0]
//      `;
//       const cursor = await db.query(aqlQuery, { startNodeId: nodeID, destinationNodeName: destinationNodeName});
//       const result = await cursor.next();
//       if (result) {
//           return result
//       } else {
//           return { status: 409, message: "no Node found"};
//       }
//   } catch (error) {
//       return { status: 409, message: error.message };
//   }
// }

   async function findShortestPathfromMultipleDest(startNode, endNodes, market = false, type = false){
    if(market && type){
      endNodes = await getWashroomOfMarket(market);
    }
    if(!endNodes){
      return {status : 409, message: `endNodes is empty`}
    }
    let finalNode = endNodes[0];
    let steps = Number.MAX_VALUE;
    for(let i=0; i<endNodes.length; i++){
      let pathSteps = await getShortestPathSteps(startNode, endNodes[i]);
      if(!pathSteps)
        continue;
      if(pathSteps< steps){
        finalNode = endNodes[i];
        steps = pathSteps;
      }
    }
    const path = await getShortestPath(startNode, finalNode);
    return path

   }
    async function getWashroomOfMarket(market){
      const query = `FOR node in nodes
      FILTER node.market == @market and node.nodeType == 'washroom'
      return node._id`;
      const bindVars = {
        market: market,
      }
      try{
        const cursor = await db.query(query, bindVars);
        const result = await cursor.all();
        return result; 
      } catch(error){
        return [];
      }
    }

   async function addMarket(market){
    market.createdAt = Date.now();
    market.updatedAt = Date.now();
    const condition1 = {name: market.name, city: market.city};
    const n1 = await upsertNode(market, condition1, 'markets');
    if(n1[0].key)
    return { status: 201, message: `market created sucessfully.` };
    else{ 
        return { status: 409, message: `There is some issue in creation of market` };
    }
   }

   async function getMarket(){
    const query = `FOR market IN markets RETURN market`;
    let res;
    try{
      const cursor = await db.query(query);
      res = await cursor.all();
      return res
    }catch(err){
      return { status: 409, message: err.message };
    }
   }

   async function updateConnection(edgeId, steps, angle){
    const query =`
         FOR edge IN roads
          FILTER edge._id == @edgeId
          UPDATE edge WITH { steps: @steps, angle: @angle } IN roads
          RETURN NEW
        `;
    const bindVars = {
        "edgeId": edgeId,
        "steps": steps,
        "angle": angle,
    };
  
    try{
      const cursor = await db.query(query, bindVars);
      const result = await cursor.all();
      return { status: 201, message: `connection updated sucessfully.` }; 
    } catch(error){
      console.error('Error updating edge type:', error);
      return { status: 409, message: `some error` }; 
    }
   }

   async function createCar(carData){
    let notInsertedCars = [];
    for(let i = 0; i< carData.length; i++){
      for(let j= 0; j<carData[i].car.length; j++){
        const carObj = {
          carNumber: carData[i].car[j],
          macAddress: carData[i].macAddress,
          inTime: Date.now(),
          market: carData[i].market
        }
        const res = await addCarInCollection(carObj);
        if(!res){
          notInsertedCars.push(carObj.carNumber);
        }
      }
    }

    if(notInsertedCars.length === 0){
      return { status: 201, message: `Cars inserted sucessfully.` };
    } else{
      return {status: 409, message: ` please insert these Cars NUmber ${notInsertedCars} once again`};
    }
   }

   async function addCarInCollection(car){
    try{
    const nodeId = await getNodeIdByMacAddress(car.macAddress, car.market);
    if(nodeId == 0){
      return 0;
    }
    car.nodeId = nodeId[0];
    const condition = {market: car.market, carNumber: car.carNumber};
    const carNode = await upsertNode(car, condition, 'carData');
    return carNode[0].key;
    } catch(err){
      console.log(err);
      return 0;
    }
   }

  async function getNodeIdByMacAddress( macAddress, market ){
    const query = `FOR 	doc IN nodes
	  FILTER doc.macAddress == @macAddress and doc.market == @market
	  return doc._id`;
    const bindVars = {
	    macAddress,
	    market
    };
      try{
        const cursor = await db.query(query, bindVars);
        const result = await cursor.all();
        return result;
      } catch(error){
        return 0;
      }
  }

   async function getCarIdByNumber(market){
      const query = `
      FOR car IN carData
      FILTER car.market == @market
      RETURN car`;
      const bindVars = {
        market : market
      };
      try{
        const cursor = await db.query(query, bindVars);
        const result = await cursor.all();
	const qrTypeDoc = await getDocForSpecificType('qrCode');
	const finalResult = {};
	finalResult['camera'] = result;
	if(qrTypeDoc)
	 finalResult['qrCode'] = qrTypeDoc;
        return finalResult;
      } catch(error){
        console.error('Error updating edge type:', error);
        return { status: 409, message: error.message }; 
      }
   }
  async function getDocForSpecificType(nodeType){
    const query = `
          FOR node in nodes
	  FILTER node.nodeType == @nodeType
	  RETURN node`;
    const bindVars = {
       nodeType : nodeType
    };
    try{	
        const cursor = await db.query(query, bindVars);
        const result = await cursor.all();
        return result;
    } catch(error){
	 return 0;
    }
  }
module.exports = {createGraphInArangoDB, getAllNodesData, getShortestPath, 
  getAllNodesDataByMarket,getbeasideNodesAtOneDepth,deleteTripData,updateConnection,
   getTripDataByMarket,createNodesInArango,findShortestPathfromMultipleDest, getShortestPathSteps, addMarket, getMarket, createCar, getCarIdByNumber}
