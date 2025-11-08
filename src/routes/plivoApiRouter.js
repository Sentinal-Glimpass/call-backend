const express = require('express');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const router = express.Router();
const upload = multer({ dest: 'list-uploads/' });

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

/**
 * @swagger
 * tags:
 *   name: Plivo API
 *   description: Protected Plivo API endpoints (requires API key authentication)
 */

const {deleteList,insertList, insertListContent,updateList, saveSingleLeadData   } = require('./../apps/plivo/plivo.js')
// Route to upload CSV
router.post('/upload-csv', upload.single('file'), async (req, res) => {
  const filePath = req.file.path;
  const listName = req.body.listName; // Expecting the list name in the request body
  const clientId = req.clientData._id.toString();
  
  if (!listName) {
    safeFileDelete(filePath); // Clean up file before returning error
    return res.status(400).json({ message: 'List name is required' });
  }

  let listId = null;

  try {
    // Save the list name and generate a list ID
    const listResult = await insertList(listName, clientId);
    if(listResult.status == 200){
        listId = listResult.listId;
    }
    if(listResult.status == 400){
        safeFileDelete(filePath);
        return res.status(400).json({
            message: listResult.message,
          });
    }

    if(listId == null){
        safeFileDelete(filePath);
        return res.status(500).json({
            message: 'Error saving data to database',
          });
    }
    const rows = [];
    const indianMobileRegex = /^(\+91|91)[6-9]\d{9}$/;
    // Read and parse the CSV file
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', async (data) => {
        let number = data.number.trim(); // Trim whitespace

        // If number starts with "0", remove it and add "91"
        if (number.startsWith("0")) {
          number = "91" + number.slice(1);
        } 
        // If number does not start with "91", add "91"
        else if (!number.startsWith("91") && !number.startsWith("+91")) {
          number = "91" + number;
        } 
        // If number starts with "91" but is only 10 digits long, add another "91"
        else if (number.startsWith("91") && number.length === 10) {
          number = "91" + number;
        }
    
        // Validate the final number
        if (indianMobileRegex.test(number)) {
          data.number = number; // Update the number in the data object
          data.listId = listId; // Add listId
          
          rows.push(data); // Push updated data object
        } else {
          await deleteList(listId);
          safeFileDelete(filePath);
          return res.status(500).json({ message: `Invalid mobile number ${number}.` });
        }
        // const row = {
        //   ...data,  // Spread the existing data properties
        //   listId,   // Add listId directly at the same level
        // };
        // rows.push(row);
      })
      .on('end', async () => {
        try {
          if (!validateCsvFormat(rows)) {
            await deleteList(listId);
            return res.status(500).json({ message: 'Invalid CSV format.' });
          }
          const count = rows.length;
          await updateList(listId, count);
          // Save all rows to MongoDB
          const result = await insertListContent(rows);

          res.status(result.status).json({
            message: result.message
          });
        } catch (err) {
          console.error(err);
          res.status(500).json({
            message: 'Error saving data to database',
          });
        }
      })
      .on('error', async (err) => {
        console.error(err);
        await deleteList(listId);
        res.status(500).json({
          message: 'Error processing CSV file',
        });
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error saving list to database' });
  } finally {
    // Always delete the temporary file, regardless of success or failure
    safeFileDelete(filePath);
  }
});

const validateCsvFormat = (data) => {
  if (data.length === 0) return false;

  // Only 'number' is mandatory, all other columns are optional and dynamic
  const headers = Object.keys(data[0]);

  // Check that 'number' column exists
  if (!headers.includes('number')) {
    console.error('CSV validation failed: "number" column is required');
    return false;
  }

  // Check that all rows have a number value
  const allRowsHaveNumber = data.every(row => row.number && row.number.trim() !== '');
  if (!allRowsHaveNumber) {
    console.error('CSV validation failed: All rows must have a valid "number" value');
    return false;
  }

  // Log detected columns for debugging
  console.log(`✅ CSV validation passed. Detected columns: ${headers.join(', ')}`);

  return true;
};

router.post('/lead-push', async(req, res) =>{
  try{
    const leadData = req.body;
    const clientData = req.clientData;
    const result = await saveSingleLeadData(leadData, clientData)
    res.status(result.status).send(result.message)
  } catch(error){
    res.status(500).send({ message: "Internal Server Error", error });
  }

})

module.exports = router;