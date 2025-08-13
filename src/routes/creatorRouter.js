
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const upload = multer({ dest: 'uploads/' });
const bucketName = 'glimpass_image';

// Helper function to safely delete files
const safeFileDelete = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted temporary file: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error deleting file ${filePath}:`, error);
  }
};
const { createGraphInArangoDB, getAllNodesData, getShortestPath, 
    getAllNodesDataByMarket, getbeasideNodesAtOneDepth,updateConnection,
    deleteTripData, getTripDataByMarket, createNodesInArango, findShortestPathfromMultipleDest, getShortestPathSteps, addMarket,getMarket, createCar, getCarIdByNumber} = require('../apps/creator/creator');
// const {updateImageUrlInArango} = require('../apps/creator/imageUpload')

/**
 * @swagger
 * tags:
 *   name: Graph
 *   description: Graph operations for navigation and pathfinding
 */

router.post('/create', async (req, res) => {
    try {
        const tripData = req.body;
        const result = await createGraphInArangoDB(tripData);
        res.status(result.status).send({ message: result.message });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/create-nodes', async (req, res) => {
    try{
        const nodesData = req.body;
        const result = await createNodesInArango(nodesData);
        res.status(result.status).send({ message: result.message });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/get-all-nodes-by-market', async (req, res) => {
    try {
        const market = req.body.market;
        const result = await getAllNodesDataByMarket(market);
        res.json(result);
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

/**
 * @swagger
 * /graph/get-all-nodes:
 *   get:
 *     tags: [Graph]
 *     summary: Get all nodes in the graph
 *     description: Retrieves all nodes from the ArangoDB graph database
 *     responses:
 *       200:
 *         description: List of all nodes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   nodeId:
 *                     type: string
 *                     example: "nodes/14544714"
 *                   name:
 *                     type: string
 *                     example: "Shop 1"
 *                   floor:
 *                     type: number
 *                     example: 1
 *                   nodeType:
 *                     type: string
 *                     example: "shop"
 *                   coordinates:
 *                     type: object
 *                     properties:
 *                       x:
 *                         type: number
 *                       y:
 *                         type: number
 *       500:
 *         description: Internal server error
 */
router.get('/get-all-nodes', async (req, res) => {
    try {
	    console.log(233)
        const result = await getAllNodesData();
	    console.log(2)
        res.json(result);
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

// router.get('/graph/get-nodes', async (req, res) => {
//     try {
        
//         const result = await getAllNodesWithCheckPoint();
//         res.json(result);
//     } catch (error) {
//         res.status(500).send({ message: "Internal Server Error", error });
//     }
// });

router.post('/get-shortest-path', async (req, res) => {
    try {
        const startNode = req.body.currentNode;
        const endNode = req.body.destinationNode;
        const endNodeName = req.body.endNodeName;
        const endNodeList = req.body.endNodesList;
        let result;
        if(endNodeList.length != 0){
             result = await findShortestPathfromMultipleDest(startNode, endNodeList)
        } else{
             result = await getShortestPath(startNode, endNode);
        }
        res.json(result);
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/get-beside-nodes', async(req, res) => {
    try{
        const nodeId = req.body.startNodeId;
        //const nodeId = "nodes/14068964";
        const result =  await getbeasideNodesAtOneDepth(nodeId);
        res.json(result);
    } catch(error){
        res.status(500).send({message: "Internal Server Error", error});
    }
})

router.post('/delete-trip-data', async(req, res) =>{
    try{
        const tripId = req.body.tripId;
        const result = await deleteTripData(tripId);
        res.status(result.status).send(result.message);
    } catch(error){
        res.status(500).send({message: "Internal Server Error", error});
    }
})

router.post('/get-trip-data-by-market', async(req, res) => {
    try{
        const market = req.body.market;
        const result = await getTripDataByMarket(market);
        res.json(result);
    }catch(error){
        res.status(500).send({message: "Internal Server Error", error});
    }
})

router.post('/add-market', async(req, res) => {
    try{
        const market = req.body;
        // const market = {'name': 'ambience', 'city':'delhi'};
        const result = await addMarket(market);
        res.status(result.status).send({ message: result.message });
    }catch(error){
        res.status(500).send({message: "Internal Server Error", error});
    }
})

router.get('/get-all-market', async(req, res) => {
    try{
        const result = await getMarket();
        res.json(result)
    }catch(error){
        res.status(500).send({message: "Internal Server Error", error});
    }
})

router.post('/update-connection', async(req, res) => {
    try{
        const edgeId = req.body.edgeId;
        const stpes = req.body.steps;
        const angle = req.body.angle;
        const result = await updateConnection(edgeId, stpes, angle);
        res.status(result.status).send({ message: result.message });
    }catch(error){
        res.status(500).send({message: "Internal Server Error", error});
    }
})

router.post('/create-car-node', async(req, res) => {
    try{
        const carData = req.body;
        const result = await createCar(carData);
        res.status(result.status).send({ message: result.message });
    }catch(error){
        res.status(500).send({message: "Internal Server Error", error});
    }
})

router.post('/get-car-by-number', async(req, res) => {
    try{
        const market = req.body.market;
        const result = await getCarIdByNumber(market);
        res.json(result);
    }catch(error){
        res.status(500).send({message: "Internal Server Error", error});
    }
})

router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = req.file.path;
    const folderName = req.body.folderName || 'defaultFolder'; // Use a default if not provided
    
    try {
        // Uploads the file to Google Cloud Storage
        const bucket = storage.bucket(bucketName);
        const fileName = `${folderName}/${req.file.originalname}`; 
      //  const nodeId = req.body.nodeId;
        await bucket.upload(filePath, {
            destination: fileName, // Dynamic folder name
        });
        // const options = {
        //     action: 'read',
        //     expires: '12-31-9999',  // 48 hours
        // };
    
        // const [url] = await bucket.file(fileName).getSignedUrl(options);
        const url = `https://storage.googleapis.com/${bucketName}/${fileName}`;
        res.json(url);
        // const result = await updateImageUrlInArango(nodeId, url);
        // res.status(result.status).send({ message: result.message });
        // res.status(200).send('File uploaded successfully.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error uploading the file.');
    } finally {
        // Always delete the temporary file, regardless of success or failure
        safeFileDelete(filePath);
    }
});
module.exports = router;



//gcloud compute ssh glimpass --zone us-west4-b  "C:\Users\PIYUSH\OneDrive\Desktop\glimpass"
// scp -r /c/Users/PIYUSH/OneDrive/Desktop/glimpass glimpass:~/glimpass

//Add-Content -Path = C:\Users\PIYUSH\.ssh\authorized_keys -Value = ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDyu7IPb3M79N2J9qsHtM6qFppXqvAuRbI0VCIt5NMSU8M+eo8JTg6fvbm2MKQG3iJm7Vky6hUgQORn6WRdecHsIF2+a6kZv4XmYgmDeJQaJQaUo6egRWjY5yfggaCyaBpPDh9PZU1Cq5GbQ8ECDya/CFqK9LRfx+okAEFV2gTgKNMDQ/pJWoeXIHtifDwMbhGoW5M+fsj9tNLjLFIhcL/II3O+aOqNIqDn+77FP593bg8fGBtPvxLV+17I/EPt+RY3sMN9nhhkPdXg+oG3Z+Q1kzrOQVS/GIV4GSmoQ7xMdsWUAGqmLKGMs5C2cgdc6zBJegz7V6olc8elpuaWT5RSkgVwxeaWj3SPxC2tlQdeHRG1fTFj81J73JwX11wIg6dql7fun3R3s6Tp1DyFqMtMHb/gwmVxvHC+H9WCBAPJ8VgjXWAKYRBJiOosd83Cyd8uEQWXe/cEPykeFX8MEdGtqF5kB7lfZCsfWEJwWJwpiHv07Va2qWHoi95glFHMXXM= warrior@glimpas

// Add-Content -Path authorized_keys -Value  ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDyu7IPb3M79N2J9qsHtM6qFppXqvAuRbI0VCIt5NMSU8M+eo8JTg6fvbm2MKQG3iJm7Vky6hUgQORn6WRdecHsIF2+a6kZv4XmYgmDeJQaJQaUo6egRWjY5yfggaCyaBpPDh9PZU1Cq5GbQ8ECDya/CFqK9LRfx+okAEFV2gTgKNMDQ/pJWoeXIHtifDwMbhGoW5M+fsj9tNLjLFIhcL/II3O+aOqNIqDn+77FP593bg8fGBtPvxLV+17I/EPt+RY3sMN9nhhkPdXg+oG3Z+Q1kzrOQVS/GIV4GSmoQ7xMdsWUAGqmLKGMs5C2cgdc6zBJegz7V6olc8elpuaWT5RSkgVwxeaWj3SPxC2tlQdeHRG1fTFj81J73JwX11wIg6dql7fun3R3s6Tp1DyFqMtMHb/gwmVxvHC+H9WCBAPJ8VgjXWAKYRBJiOosd83Cyd8uEQWXe/cEPykeFX8MEdGtqF5kB7lfZCsfWEJwWJwpiHv07Va2qWHoi95glFHMXXM= warrior@glimpas


// scp -r -i /c/Users/PIYUSH/.ssh/id_rsa.pub /c/Users/PIYUSH/OneDrive/Desktop/glimpass piyush@glimpass:~/glimpass


