const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const db = require("../../../models/db.js");

const bucketName = 'glimpass_image';



async function uploadFile(filePath, destination) {
    console.log(filePath, destination)
    await storage.bucket(bucketName).upload(filePath, {
        destination: destination,
    });
    console.log(`${filePath} uploaded to ${bucketName}/${destination}`);
}

// async function downloadFile(source, destination) {
//     const options = { destination: destination };
//     await storage.bucket(bucketName).file(source).download(options);
//     console.log(`gs://${bucketName}/${source} downloaded to ${destination}`);
// }

// async function listFiles() {
//     const [files] = await storage.bucket(bucketName).getFiles();
//     console.log('Files:');
//     files.forEach(file => console.log(file.name));
// }

// Usage Examples:
// Uncomment the following lines to perform the operations

// createBucket().catch(console.error); // To create a new bucket

//uploadFile("\selena-gomez-we-day-california-1524671352.jpg", 'random/selena-gomez-we-day-california-1524671352.jpg').catch(console.error); // To upload a file

// downloadFile('source/path/in/bucket.jpg', 'local/path/to/destination.jpg').catch(console.error); // To download a file

// listFiles().catch(console.error); // To list files in the bucket

// async function updateImageUrlInArango(nodeId, url){
//  try{
//     const query = `
//     FOR node IN nodes
//     FILTER node._id == @nodeId
//     UPDATE node WITH { imageUrl: @url } IN nodes`;

//     const bindVars = {
//         "nodeId": nodeId,
//         "url": url
//     };

//         // Execute the query
//     const result = await db.query(query, bindVars);

//     // Check the result
//     if(result)
//       return { status: 201, message: `Node with ID ${nodeId} updated with imageUrl: ${url}` };
//     else{
//         return { status: 409, message: `No node found with ID ${nodeId}` };
//     }
//     } catch (error) {
//         console.error('Error updating imageUrl in ArangoDB:', error);
//         return { status: 409, message: error };
//     }
// }
// module.exports = {updateImageUrlInArango}