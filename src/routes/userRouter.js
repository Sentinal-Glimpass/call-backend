const express = require('express');
const router = express.Router();
const {findNearestEntity, registerUser, userLogin, storeFeedbackOfUser, getAllDataOfMarketFloorWise} = require('../apps/user/user');
const { getSemanticScore } = require('../apps/user/semamtic')
const { findShortestPathfromMultipleDest } = require('../apps/creator/creator');

/**
 * @swagger
 * tags:
 *   name: User
 *   description: User management and entity finding operations
 */

/**
 * @swagger
 * /user/register:
 *   post:
 *     tags: [User]
 *     summary: Register a new user
 *     description: Creates a new user account with the provided user data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               name:
 *                 type: string
 *                 example: John Doe
 *               phone:
 *                 type: string
 *                 example: "+1234567890"
 *     responses:
 *       200:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 userId:
 *                   type: string
 *       500:
 *         description: Internal server error
 */
router.post('/register',async( req,res ) => {
    try{
        const userData = req.body
        const result = await registerUser(userData);
        res.json(result);
    }catch (error){
        res.status(500).send({messsage: "Internal server error", error});
    }
});

/**
 * @swagger
 * /user/login:
 *   post:
 *     tags: [User]
 *     summary: User login
 *     description: Authenticate a user with email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   type: object
 *       500:
 *         description: Internal server error
 */
router.post('/login',async( req,res ) => {
    try{
        const email = req.body.email
        const result = await userLogin(email);
        res.json(result);
    }catch (error){
        res.status(500).send({messsage: "Internal server error", error});
    }
});

router.post('/step-length',async( req,res ) => {
    try{

    }catch (error){
        res.send(500).send({messsage: "Internal server error", error});
    }
});

router.get('/get-step-length',async( req,res ) => {
    try{

    }catch (error){
        res.send(500).send({messsage: "Internal server error", error});
    }
});
router.post('/get-nearest-washroom', async(req,res) =>{
    // let nodes = {
    //     "nodeId": "nodes/14544714",
    //     "name": "pshop1",
    //     "floor": 1,
    //     "nodeType": "shop",
    //     "subType": null,
    //     "category": []
    // };
    try{
        const nodes = req.body.nodeId;
        const type = req.body.nodeType;
        const market = req.body.market;
        const result = await findShortestPathfromMultipleDest(nodes, false, market, type);
        res.json(result);
    }catch (error){
        res.status(500).send({messaage: "Interval server error", error});
    }  
});

router.post('/feedback', async(req,res) => {
   try{
    const userId = req.body.userId;
    const feedback = req.body.feedback;
    const result = await storeFeedbackOfUser(userId, feedback);
    res.status(result.status).send({message: result.message});
   } catch(error){
    res.status(500).send({message: "Interval server error", error});
   }
});

router.post('/floor-all-data', async(req, res) => {
    try{
        const floor = req.body.floor; 
        const market = req.body.market;
        const result = await getAllDataOfMarketFloorWise(floor, market);
        res.json(result);
    } catch(error){
    res.status(500).send({message: "Interval server error", error});
    }
});
router.post('/get-semantic-score', async(req, res) => {
    try{
        const set1 = req.body.tag1; 
        const set2 = req.body.tag2;
        // const set1 = ["autumn", "landscape", "breeze", "harvest", "leaf", "acorn", "migration", "pumpkin", "sweater", "orchard",
        // "football", "hayride", "cornucopia", "cider", "bonfire", "scarecrow", "harmony", "equinox", "october", "chestnut"];
        // const set2 = ["winter", "snowflake", "chill", "fireplace", "icicle", "blizzard", "sleigh", "wool", "hibernate", "frost",
        // "eggnog", "yule", "flannel", "december", "glacier", "polar", "solstice", "ornament", "evergreen", "gloves"];
        const result = await getSemanticScore(set1, set2);
        res.json(result);
    } catch(error){
    res.status(500).send({message: "Interval server error", error});
    }
});
module.exports = router;
