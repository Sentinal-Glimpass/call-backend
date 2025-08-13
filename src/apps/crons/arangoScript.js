const { exec } = require("child_process");
const { Storage } = require("@google-cloud/storage");
const fs = require("fs");
const path = require("path");
const os = require("os");
// Initialize Google Cloud Storage
const storage = new Storage();
const bucketName = 'arango_backup'; // Replace with your bucket name

// ArangoDB connection configuration from environment variables
require('dotenv').config();
const serverEndpoint = process.env.ARANGO_ENDPOINT || "ssl://localhost:8529";
const dbName = process.env.ARANGO_DATABASE || "_system";
const username = process.env.ARANGO_USERNAME || "root";
const password = process.env.ARANGO_PASSWORD;

if (!password) {
  throw new Error('ARANGO_PASSWORD environment variable is required');
}

// Create a temporary directory for the backup
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arangodb-backup-'));

// Function to execute shell command
function execShellCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 5000 }, (error, stdout, stderr) => { // Adjust buffer size as needed
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`);
        reject(stderr);
        return;
      }
      console.log(`stdout: ${stdout}`);
      resolve(stdout);
    });
  });
}

// Function to recursively upload a directory to Google Cloud Storage
async function uploadDirectory(bucketName, srcDirectory, destDirectory) {
  const files = fs.readdirSync(srcDirectory);

  for (const file of files) {
    const srcFilePath = path.join(srcDirectory, file);
    const destFilePath = path.join(destDirectory, file);
    const stats = fs.statSync(srcFilePath);

    if (stats.isFile()) {
      console.log(`Uploading ${srcFilePath} to ${destFilePath}...`);
      await storage.bucket(bucketName).upload(srcFilePath, {
        destination: destFilePath,
      });
    } else if (stats.isDirectory()) {
      await uploadDirectory(bucketName, srcFilePath, destFilePath);
    }
  }
}

// Main function to perform backup and upload
async function backupAndUpload() {
  try {
    // Backup command
    const backupCommand = `arangodump --server.endpoint ${serverEndpoint} --server.database ${dbName} --server.username ${username} --server.password ${password} --output-directory ${tmpDir}`;

    // Create backup
    console.log("Creating ArangoDB backup...");
    await execShellCommand(backupCommand);

    // Upload the backup directory
    console.log("Uploading backup to Google Cloud Storage...");
    const destDirectory = `backups/dump-${Date.now()}`; // Customize your destination path as needed
    await uploadDirectory(bucketName, tmpDir, destDirectory);

    // Cleanup local backup files
    console.log("Cleaning up local backup files...");
    fs.rmdirSync(tmpDir, { recursive: true });
    console.log("Backup and upload completed successfully.");
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// Run the backup and upload process
backupAndUpload();
