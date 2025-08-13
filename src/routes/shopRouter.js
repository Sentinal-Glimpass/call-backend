const express = require('express');
const router = express.Router();
const {createShop, updateShop, getAllShops, getShopByMail} = require('../apps/shop/shop')
// router.post('add-analytics-data', async (req, res) => {
//     try{
//     const footfall = req.body.footfall;
//     const nodeId = req.body.nodeId;
//     const interested = req.body.interested;
//     const view = req.body.view;
//     } catch(error){
        
//     }

// });


router.post('/create-shop', async (req, res) => {
    try {
        const shopData = req.body;
        // console.log(34554);
        // const shopData = {name : 'ramaa',
        //                         add: 'rammmffdfddffd' }
        const result = await createShop(shopData);
        res.status(result.status).send({ message: result.message });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/update-shop', async (req, res) => {
    try {

        const key = req.body.key;
        const shopData = req.body.shopData
        // const key = 'dm_shops/637023';
        // const shopData = {vill : 'grh', pin: '845303'}
        const result = await updateShop(key, shopData);
        res.status(result.status).send({ message: result.message });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.get('/get-all-shops', async (req, res) => {
	try {
	   const result = await getAllShops();
	    res.json(result);
	} catch (error) {
	   res.status(500).send({ message: "Internal Server Error", error });
	}
});

router.post('/get-shops-by-mail', async (req, res) => {
     try{ 
	 const email = req.body.mail;
	 const password = req.body.password;
	 //const email = 'ejahaj'
	 //const password = 'wtee';
         const result = await getShopByMail(email, password);
	 res.json(result);
     } catch (error) {
	 res.status(500).send({ message: "Internal Server Error", error });
     }
});
module.exports = router;
