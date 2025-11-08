const { error } = require('console');
const e = require('express');
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const { 
  authenticateToken, 
  validateResourceOwnership, 
  auditLog 
} = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: IP
 *   description: IP pool management and session handling
 */

const FILE_PATH = 'ipPool.json';
const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds
var ipPool;
// Load IP Pool from File or Initialize
async function initializeIpPool() {
    try {
      // Check if the file exists
      await fs.access(FILE_PATH); // If accessible, no error will be thrown
      ipPool = JSON.parse(await fs.readFile(FILE_PATH, 'utf8'));
    } catch (err) {
      // If file does not exist or cannot be accessed, initialize default
      console.log('File does not exist or is not accessible. Initializing default IP pool.');
      ipPool = [   
        { "ip": "35.235.127.93", "lastReturned": 0, "session_id": "1azby" },
        { "ip": "34.102.18.24", "lastReturned": 0, "session_id": "2azby"},
        { "ip": "34.94.207.154", "lastReturned": 0, "session_id": "3azby" },
        { "ip": "35.236.104.148", "lastReturned": 0, "session_id": "4azby" },
        { "ip": "35.235.127.93", "lastReturned": 0, "session_id": "5azby" },
        { "ip": "34.102.18.24", "lastReturned": 0, "session_id": "6azby" },
        { "ip": "34.94.207.154", "lastReturned": 0, "session_id": "7azby" },
        { "ip": "35.236.104.148", "lastReturned": 0, "session_id": "8azby" },
        { "ip": "35.235.127.93", "lastReturned": 0, "session_id": "9azby" },
        { "ip": "34.102.18.24", "lastReturned": 0, "session_id": "10azby" },
      ];
      await fs.writeFile(FILE_PATH, JSON.stringify(ipPool, null, 2));
      console.log('File initialized with default data.');
    }
  
    return ipPool;
  }
  
  initializeIpPool();

// Save IP Pool to File
async function saveIpPool() {
   await fs.writeFile(FILE_PATH, JSON.stringify(ipPool, null, 2));
}

/**
 * @swagger
 * /ip/next_ip:
 *   get:
 *     tags: [IP]
 *     summary: Get next available IP for session
 *     description: Returns the next eligible IP address for establishing a session
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: agent_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID for the session
 *     responses:
 *       200:
 *         description: IP address allocated successfully
 *       400:
 *         description: No IP available
 *       401:
 *         description: Unauthorized
 */
// GET /next_ip - Returns the next eligible IP
router.get('/next_ip', authenticateToken, auditLog, async(req, res) => {
 
    // let ipPool = initializeIpPool();
    const now = Date.now();
    const agent_id = req.query.agent_id
    // const session_id = req.query.session_id
    for (const entry of ipPool) {
    // If the IP was never returned or last returned over 1 hour ago
    if (entry.lastReturned === 0 || now - entry.lastReturned > ONE_HOUR) {
        entry.lastReturned = now; // Update the last returned time
        await saveIpPool();
        // return res.json({"url": `ws://${entry.ip}:5001/chat/v1/${agent_id}?session_id=${entry.session_id}`});
        return res.json({"url": `wss://ivrsp.glimpass.com:5001/chat/v1/${agent_id}/session_id=${entry.session_id}`});
    }
    }
    res.status(400).json({ error: 'No IP available to return' });

});

// POST /reset_ip - Resets the lastReturned time for a specific IP

/**
 * @swagger
 * /ip/release-session:
 *   get:
 *     tags: [IP]
 *     summary: Release IP session
 *     description: Release an IP session to make it available for reuse
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: session_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID to release
 *     responses:
 *       200:
 *         description: Session released successfully
 *       500:
 *         description: Error releasing session
 */
router.get('/release-session', authenticateToken, auditLog, async(req,res) => {
    const session_id = req.query.session_id;
    // const session_id = "1azby"
    const reset = await resetIp(session_id);
    if(reset){
        res.status(200).send({message: " session released"})
    } else{
        res.status(500).send({error: "issue in releasing ip"})
    }
})

router.post('/xml-plivo', (req, res) => {
    const { wss, listId, clientId, campId, ...allQueryParams } = req.query;
    const from = req.body.From
    const to = req.body.To
    const Direction = req.body.Direction
    const CallUUID = req.body.CallUUID

    const sanitizeNumber = (num) => {
        if (!num) return null; // Handle case where num is undefined or null
        return num.replace(/^\+/, ''); // Remove leading '+'
    };

    let sanitizedFrom = sanitizeNumber(from);
    let sanitizedTo = sanitizeNumber(to);
    if(Direction != 'inbound'){
        sanitizedFrom = sanitizeNumber(to);
        sanitizedTo = sanitizeNumber(from);
    }

    // Build extraHeaders from ALL query parameters (flat structure, no nesting)
    let extraHeadersArray = [
        `from=${sanitizedFrom}`,
        `to=${sanitizedTo}`,
        `callUUID=${CallUUID}`,
        `listId=${listId}`,
        `clientId=${clientId}`,
        `campId=${campId}`,
        `provider=plivo`
    ];

    // Add ALL remaining query parameters as headers (these are CSV fields passed flat)
    const systemFields = ['wss', 'listId', 'clientId', 'campId', 'from', 'to', 'callUUID', 'provider'];
    let csvFieldCount = 0;

    for (const [key, value] of Object.entries(allQueryParams)) {
        // Skip system fields and internal fields
        if (!systemFields.includes(key) && !['_id'].includes(key) && value) {
            // Sanitize value for header (escape commas and equals)
            const sanitizedValue = String(value).replace(/,/g, '%2C').replace(/=/g, '%3D');
            extraHeadersArray.push(`${key}=${sanitizedValue}`);
            csvFieldCount++;
        }
    }

    console.log(`✅ [XML] Generated ${extraHeadersArray.length} total headers (${csvFieldCount} from CSV fields)`);

    const extraHeaders = extraHeadersArray.join(',');

    // Get base URL from environment variable, fallback to default if not set
    const baseUrl = process.env.BASE_URL || 'https://application.glimpass.com';

    const xml = `<Response>
    <Record action="${baseUrl}/plivo/callback-record-url" redirect="false" recordSession="true" maxLength="3600" />
    <Stream
        streamTimeout="3600"
	keepCallAlive="true"
	bidirectional="true"
        audioTrack="inbound"
        extraHeaders="${extraHeaders}"
	contentType="audio/x-mulaw;rate=8000"
        statusCallbackUrl="${baseUrl}/plivo/callback-url"
        statusCallbackMethod="POST">${wss}</Stream>
</Response>`;
    res.type('application/xml');
    res.send(xml);
});

async function resetIp(session_id) {
    try {
        // Read the JSON file
        const data = await fs.readFile(FILE_PATH, 'utf-8');
        const ipPool = JSON.parse(data);
        // Find all entries with the matching IP and non-zero lastReturned
        const matchingEntries = ipPool.filter(e => e.session_id === session_id && e.lastReturned !== 0);

        if (matchingEntries.length > 0) {
            // Find the entry with the earliest (smallest) non-zero lastReturned
            const earliestEntry = matchingEntries.reduce((earliest, current) => {
                return current.lastReturned < earliest.lastReturned ? current : earliest;
            });

            // Reset the lastReturned of the earliest entry
            earliestEntry.lastReturned = 0;

            // Write the updated data back to the file

            await fs.writeFile(FILE_PATH, JSON.stringify(ipPool, null, 2));
            return 1;
        }
    } catch (error) {
        console.error('Error resetting IP:', error);
        return 0;
        throw error;
    }
}
module.exports = router;
