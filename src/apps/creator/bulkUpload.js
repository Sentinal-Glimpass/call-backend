const db = require("../../../models/db.js");
const fs = require('fs');



const collectionName = 'nodes';

// Function to update nodes in the collection
async function updateNodes(collectionName, data) {
  for (const node of data) {
    try {
        const query = `FOR n IN ${collectionName}
                    FILTER n._id == @nodeId
                    UPDATE n WITH { category: @category, pricingLevel: @pricingLevel } IN ${collectionName}
                `;
        await db.query(query, {
            nodeId: node._id,
            category: node.category,
            pricingLevel: node.pricingLevel
            });
      console.log(`Node ${node._id} updated`);
    } catch (error) {
      console.error(`Error updating node ${node._id}:`, error);
    }
  }
}

// Read the JSON file and call the function
fs.readFile('category and pricingLevel.json', 'utf8', async (err, data) => {
  if (err) {
    console.error('Error reading the file:', err);
    return;
  }
  const nodes = JSON.parse(data);

  // Call the function to update nodes
  await updateNodes(collectionName, nodes);
});
