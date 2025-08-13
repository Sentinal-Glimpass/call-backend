const db = require("../../../models/db.js");

const dmShops = db.collection('dm_shops');

async function createShop(shopData){
    try {
        const result = await dmShops.save(shopData);
        console.log('Document created:', result);
        return { status: 201, message: `Shop created sucessfully.` };
      } catch (error) {
        console.error('Failed to create document:', error);
      }
}

async function updateShop(key, shopData) {
    try {
      const result = await dmShops.update(key, shopData);
      console.log('Document updated:', result);
      return { status: 201, message: `Shop updated sucessfully.` };
    } catch (error) {
      console.error('Failed to update document:', error);
    }
}

async function getAllShops() {
   const query = `FOR shop IN dm_shops RETURN shop`;
   let res;
   try {
	 const cursor = await db.query(query);
	 res = await cursor.all();
   }catch(err) {
	   console.log(err.message);
   }
	
	return res;
}
async function getShopByMail(email, password) {
   let query = `
    FOR user IN dm_shops
    FILTER user.email == @email AND user.password == @password
    RETURN user
    `;
   const bindVars = { email, password};
   let res;
   try {
      const cursor =  await db.query(query, bindVars);
      res = await cursor.all();
   } catch(err) {
      console.log(err.message);
   }
    return res;
}
module.exports = {createShop, updateShop, getAllShops, getShopByMail}
