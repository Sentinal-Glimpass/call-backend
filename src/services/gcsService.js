const { Storage } = require('@google-cloud/storage');
const path = require('path');
const crypto = require('crypto');

/**
 * Google Cloud Storage Service
 *
 * Handles file uploads to GCS with proper validation and security
 */

// Initialize GCS client
let storage;

function initializeGCS() {
  if (!storage) {
    const config = {
      projectId: process.env.GCS_PROJECT_ID
    };

    // Use key file if provided, otherwise rely on default credentials
    if (process.env.GCS_KEY_FILE) {
      config.keyFilename = process.env.GCS_KEY_FILE;
    } else if (process.env.GCS_CREDENTIALS_JSON) {
      // Decode base64 credentials if provided
      const credentials = JSON.parse(
        Buffer.from(process.env.GCS_CREDENTIALS_JSON, 'base64').toString()
      );
      config.credentials = credentials;
    }

    storage = new Storage(config);
  }
  return storage;
}

// File validation constants
const MAX_FILE_SIZE = parseInt(process.env.MAX_ATTACHMENT_SIZE) || 10485760; // 10MB default
const ALLOWED_MIME_TYPES = process.env.ALLOWED_ATTACHMENT_TYPES
  ? process.env.ALLOWED_ATTACHMENT_TYPES.split(',').map(type => type.trim())
  : [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

/**
 * Validate file upload
 */
function validateFile(file) {
  const errors = [];

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    errors.push(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (${(MAX_FILE_SIZE / 1024 / 1024).toFixed(2)}MB)`);
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    errors.push(`File type '${file.mimetype}' is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  // Check filename
  if (!file.originalname || file.originalname.length > 255) {
    errors.push('Invalid filename or filename too long (max 255 characters)');
  }

  // Check for potentially dangerous file extensions
  const dangerousExtensions = ['.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar'];
  const extension = path.extname(file.originalname).toLowerCase();
  if (dangerousExtensions.includes(extension)) {
    errors.push(`File extension '${extension}' is not allowed for security reasons`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Generate secure filename
 */
function generateSecureFilename(originalFilename, clientId, templateId = null) {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const extension = path.extname(originalFilename);
  const baseName = path.basename(originalFilename, extension).replace(/[^a-zA-Z0-9-_]/g, '_');

  const prefix = templateId ? `templates/${templateId}` : `attachments/${clientId}`;
  return `${prefix}/${timestamp}_${randomSuffix}_${baseName}${extension}`;
}

/**
 * Upload file to GCS
 */
async function uploadFile(file, clientId, templateId = null) {
  try {
    // Validate file
    const validation = validateFile(file);
    if (!validation.isValid) {
      return {
        success: false,
        message: 'File validation failed',
        errors: validation.errors
      };
    }

    // Initialize GCS
    const gcs = initializeGCS();
    const bucket = gcs.bucket(process.env.GCS_BUCKET_NAME);

    // Generate secure filename
    const filename = generateSecureFilename(file.originalname, clientId, templateId);

    // Create file reference
    const gcsFile = bucket.file(filename);

    // Upload file
    const stream = gcsFile.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        metadata: {
          originalName: file.originalname,
          clientId: clientId,
          templateId: templateId || null,
          uploadedAt: new Date().toISOString()
        }
      },
      resumable: false
    });

    return new Promise((resolve, reject) => {
      stream.on('error', (error) => {
        console.error('GCS upload error:', error);
        resolve({
          success: false,
          message: 'File upload failed',
          error: error.message
        });
      });

      stream.on('finish', async () => {
        try {
          // Make file publicly readable if needed (optional)
          // await gcsFile.makePublic();

          // Get public URL
          const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${filename}`;

          resolve({
            success: true,
            message: 'File uploaded successfully',
            data: {
              filename: filename,
              originalname: file.originalname,
              mimetype: file.mimetype,
              size: file.size,
              gcs_url: publicUrl,
              gcs_path: filename
            }
          });
        } catch (error) {
          console.error('Error finalizing upload:', error);
          resolve({
            success: false,
            message: 'Upload finalization failed',
            error: error.message
          });
        }
      });

      // Write file buffer to stream
      stream.end(file.buffer);
    });

  } catch (error) {
    console.error('Error uploading file to GCS:', error);
    return {
      success: false,
      message: 'File upload service error',
      error: error.message
    };
  }
}

/**
 * Delete file from GCS
 */
async function deleteFile(gcsPath) {
  try {
    const gcs = initializeGCS();
    const bucket = gcs.bucket(process.env.GCS_BUCKET_NAME);
    const file = bucket.file(gcsPath);

    await file.delete();

    return {
      success: true,
      message: 'File deleted successfully'
    };
  } catch (error) {
    console.error('Error deleting file from GCS:', error);
    return {
      success: false,
      message: 'File deletion failed',
      error: error.message
    };
  }
}

/**
 * Get file info from GCS
 */
async function getFileInfo(gcsPath) {
  try {
    const gcs = initializeGCS();
    const bucket = gcs.bucket(process.env.GCS_BUCKET_NAME);
    const file = bucket.file(gcsPath);

    const [metadata] = await file.getMetadata();

    return {
      success: true,
      data: {
        name: metadata.name,
        size: metadata.size,
        contentType: metadata.contentType,
        created: metadata.timeCreated,
        updated: metadata.updated
      }
    };
  } catch (error) {
    console.error('Error getting file info from GCS:', error);
    return {
      success: false,
      message: 'File info retrieval failed',
      error: error.message
    };
  }
}

module.exports = {
  validateFile,
  uploadFile,
  deleteFile,
  getFileInfo,
  generateSecureFilename,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES
};