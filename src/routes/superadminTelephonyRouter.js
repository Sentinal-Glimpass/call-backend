/**
 * Superadmin Telephony Router
 * Manages phone numbers, apps, and assignments across Plivo and Twilio
 * for both platform (markAIble) and client accounts.
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticateSuperKey } = require('../middleware/authMiddleware');
const TelephonyCredentialsService = require('../services/telephonyCredentialsService');
const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');

// All routes require Super Key authentication
router.use(authenticateSuperKey);

// ==================== HELPERS ====================

/**
 * Resolve provider credentials based on source and optional clientId.
 * - source=platform  -> use env vars for the markAIble account
 * - source=client    -> use telephonyCredentialsService to fetch client creds
 *
 * Returns { authId, authToken } for Plivo or { accountSid, authToken } for Twilio.
 */
async function resolveCredentials(provider, source, clientId) {
  if (source === 'client') {
    if (!clientId) {
      throw new Error('clientId is required when source is "client"');
    }
    const creds = await TelephonyCredentialsService.getCredentials(clientId, provider);
    if (!creds || creds.error || !creds.isClientSpecific) {
      throw new Error(`No ${provider} credentials configured for this client. The client needs to set up their ${provider} account first.`);
    }
    if (provider === 'plivo') {
      return {
        authId: creds.accountSid,
        authToken: creds.authToken
      };
    }
    // twilio
    return {
      accountSid: creds.accountSid,
      authToken: creds.authToken
    };
  }

  // source === 'platform' (default)
  if (provider === 'plivo') {
    const authId = process.env.PLIVO_ACCOUNT_SID;
    const authToken = process.env.PLIVO_AUTH_TOKEN;
    if (!authId || !authToken) {
      throw new Error('Platform Plivo credentials (PLIVO_ACCOUNT_SID, PLIVO_AUTH_TOKEN) are not configured');
    }
    return { authId, authToken };
  }

  // twilio
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error('Platform Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) are not configured');
  }
  return { accountSid, authToken };
}

/**
 * Compute a rarity score for a phone number.
 * Higher score = rarer/more premium number.
 *
 * Factors:
 *   1. Fewer distinct digits → rarer
 *   2. Longer max consecutive repeat (e.g. 5555) → rarer
 *   3. Higher dominant digit ratio → rarer
 *   4. Repeating block pattern (e.g. 91806-91806) → big bonus
 *   5. Sequential run ascending/descending (e.g. 123456) → big bonus
 *   6. Double pairs (e.g. 11223344) → bonus
 *   7. Palindrome in local part → bonus
 */
function computeRarityScore(fullNumber) {
  // Work with the local part (strip country+area code — last 8 digits typically)
  const digits = fullNumber.replace(/\D/g, '');
  const local = digits.length > 6 ? digits.slice(-8) : digits;

  let score = 0;

  // 1. Distinct digits (fewer = rarer)
  const distinctCount = new Set(local.split('')).size;
  score += (10 - distinctCount) * 100;

  // 2. Max consecutive repeat run
  let maxRun = 1, currentRun = 1;
  for (let i = 1; i < local.length; i++) {
    if (local[i] === local[i - 1]) {
      currentRun++;
      if (currentRun > maxRun) maxRun = currentRun;
    } else {
      currentRun = 1;
    }
  }
  score += maxRun * 20;

  // 3. Dominant digit ratio
  const freq = {};
  for (const d of local) freq[d] = (freq[d] || 0) + 1;
  const maxFreq = Math.max(...Object.values(freq));
  score += (maxFreq / local.length) * 50;

  // 4. Repeating block pattern — check if any substring of length 3-5 repeats consecutively
  for (let blockLen = 3; blockLen <= Math.floor(local.length / 2); blockLen++) {
    for (let start = 0; start <= local.length - blockLen * 2; start++) {
      const block = local.substring(start, start + blockLen);
      const next = local.substring(start + blockLen, start + blockLen * 2);
      if (block === next) {
        score += 100 + blockLen * 10; // longer repeating blocks score higher
        break;
      }
    }
  }

  // Also check full number for repeating blocks (e.g. 9180691806)
  for (let blockLen = 4; blockLen <= Math.floor(digits.length / 2); blockLen++) {
    for (let start = 0; start <= digits.length - blockLen * 2; start++) {
      const block = digits.substring(start, start + blockLen);
      const next = digits.substring(start + blockLen, start + blockLen * 2);
      if (block === next) {
        score += 100 + blockLen * 10;
        break;
      }
    }
  }

  // 5. Sequential run (ascending or descending, min 4 digits)
  let maxAsc = 1, maxDesc = 1, curAsc = 1, curDesc = 1;
  for (let i = 1; i < local.length; i++) {
    const diff = parseInt(local[i]) - parseInt(local[i - 1]);
    if (diff === 1) { curAsc++; maxAsc = Math.max(maxAsc, curAsc); } else { curAsc = 1; }
    if (diff === -1) { curDesc++; maxDesc = Math.max(maxDesc, curDesc); } else { curDesc = 1; }
  }
  const maxSeq = Math.max(maxAsc, maxDesc);
  if (maxSeq >= 4) score += 80 + (maxSeq - 4) * 40; // 4-digit seq = 80, 5 = 120, 6 = 160...

  // 6. Double pairs (e.g. 11223344)
  let pairCount = 0;
  for (let i = 0; i < local.length - 1; i += 2) {
    if (local[i] === local[i + 1]) pairCount++;
  }
  if (pairCount >= 3) score += 60;

  // 7. Palindrome check on local part
  const reversed = local.split('').reverse().join('');
  if (local === reversed && local.length >= 4) score += 80;

  return score;
}

/**
 * Build basic auth header value.
 */
function basicAuth(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

/**
 * Make a Plivo API request.
 */
async function plivoRequest(method, authId, authToken, path, data = null, params = null) {
  const url = `https://api.plivo.com/v1/Account/${authId}${path}`;
  const config = {
    method,
    url,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': basicAuth(authId, authToken)
    }
  };
  if (data) config.data = data;
  if (params) config.params = params;
  return axios(config);
}

/**
 * Make a Twilio API request.
 */
async function twilioRequest(method, accountSid, authToken, path, data = null, params = null) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`;
  const config = {
    method,
    url,
    headers: {
      'Authorization': basicAuth(accountSid, authToken)
    }
  };

  // Twilio POST/PUT use form-encoded bodies
  if (data && (method === 'POST' || method === 'PUT')) {
    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    }
    config.data = formData.toString();
    config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (params) {
    config.params = params;
  }

  return axios(config);
}

/**
 * Get the MongoDB collection for phone number assignments.
 */
async function getAssignmentsCollection() {
  await connectToMongo();
  const database = client.db('talkGlimpass');
  return database.collection('phoneNumberAssignments');
}

/**
 * Extract provider/source/clientId from req (query for GET, body for POST/PUT/DELETE).
 */
function extractParams(req) {
  const src = req.method === 'GET' ? req.query : req.body;
  const provider = (src.provider || 'plivo').toLowerCase();
  const source = (src.source || 'platform').toLowerCase();
  const clientId = src.clientId || null;

  if (!['plivo', 'twilio'].includes(provider)) {
    throw new Error('provider must be "plivo" or "twilio"');
  }
  if (!['platform', 'client'].includes(source)) {
    throw new Error('source must be "platform" or "client"');
  }

  return { provider, source, clientId };
}

// ==================== PHONE NUMBERS ====================

/**
 * @swagger
 * /superadmin/telephony/numbers:
 *   get:
 *     summary: List owned phone numbers
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *         description: Telephony provider (default plivo)
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [platform, client]
 *         description: Credential source (default platform)
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *         description: Client ID (required when source=client)
 *     responses:
 *       200:
 *         description: List of owned phone numbers
 */
router.get('/numbers', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const creds = await resolveCredentials(provider, source, clientId);

    let numbers = [];

    if (provider === 'plivo') {
      const resp = await plivoRequest('GET', creds.authId, creds.authToken, '/Number/', null, {
        limit: 100
      });

      // Fetch all apps to build appId -> answerUrl map
      let appMap = {};
      try {
        const appsResp = await plivoRequest('GET', creds.authId, creds.authToken, '/Application/', null, { limit: 100 });
        (appsResp.data.objects || []).forEach(app => {
          appMap[app.app_id] = {
            appName: app.app_name || '',
            answerUrl: app.answer_url || ''
          };
        });
      } catch (e) { /* apps fetch is best-effort */ }

      // Get assistants collection for name lookups
      await connectToMongo();
      const database = client.db('talkGlimpass');
      const assistantsCol = database.collection('assistant');

      // Extract agent IDs from answer URLs
      const agentIds = new Set();
      Object.values(appMap).forEach(app => {
        const match = app.answerUrl.match(/chat\/v2\/([a-f0-9]{24})/);
        if (match) agentIds.add(match[1]);
      });

      // Batch lookup agent names
      const agentNameMap = {};
      if (agentIds.size > 0) {
        const agentDocs = await assistantsCol.find({
          _id: { $in: Array.from(agentIds).map(id => new ObjectId(id)) }
        }).project({ agent_name: 1 }).toArray();
        agentDocs.forEach(a => { agentNameMap[a._id.toString()] = a.agent_name; });
      }

      numbers = (resp.data.objects || []).map(n => {
        // Extract app ID from application path: /v1/Account/.../Application/{appId}/
        let connectedAgent = null;
        if (n.application) {
          const appIdMatch = n.application.match(/Application\/(\d+)\/?$/);
          if (appIdMatch) {
            const appId = appIdMatch[1];
            const app = appMap[appId];
            if (app && app.answerUrl) {
              const agentMatch = app.answerUrl.match(/chat\/v2\/([a-f0-9]{24})/);
              if (agentMatch) {
                const agentId = agentMatch[1];
                connectedAgent = {
                  agentId,
                  agentName: agentNameMap[agentId] || agentId,
                  appId,
                  appName: app.appName
                };
              }
            }
          }
        }

        return {
          number: n.number,
          alias: n.alias || '',
          country: n.country || '',
          type: n.type || 'local',
          application: n.application || '',
          monthlyRentalRate: n.monthly_rental_rate || '',
          addedOn: n.added_on || '',
          connectedAgent
        };
      });
    } else {
      // Twilio - extract agent from voiceUrl directly
      await connectToMongo();
      const database = client.db('talkGlimpass');
      const assistantsCol = database.collection('assistant');

      const resp = await twilioRequest('GET', creds.accountSid, creds.authToken, '/IncomingPhoneNumbers.json');
      const rawNumbers = resp.data.incoming_phone_numbers || [];

      // Collect agent IDs
      const agentIds = new Set();
      rawNumbers.forEach(n => {
        const match = (n.voice_url || '').match(/chat\/v2\/([a-f0-9]{24})/);
        if (match) agentIds.add(match[1]);
      });

      const agentNameMap = {};
      if (agentIds.size > 0) {
        const agentDocs = await assistantsCol.find({
          _id: { $in: Array.from(agentIds).map(id => new ObjectId(id)) }
        }).project({ agent_name: 1 }).toArray();
        agentDocs.forEach(a => { agentNameMap[a._id.toString()] = a.agent_name; });
      }

      numbers = rawNumbers.map(n => {
        let connectedAgent = null;
        const agentMatch = (n.voice_url || '').match(/chat\/v2\/([a-f0-9]{24})/);
        if (agentMatch) {
          const agentId = agentMatch[1];
          connectedAgent = {
            agentId,
            agentName: agentNameMap[agentId] || agentId,
          };
        }

        return {
          number: n.phone_number,
          friendlyName: n.friendly_name || '',
          sid: n.sid,
          country: n.iso_country || '',
          voiceUrl: n.voice_url || '',
          dateCreated: n.date_created || '',
          connectedAgent
        };
      });
    }

    res.status(200).json({ success: true, data: numbers });
  } catch (error) {
    console.error('Error listing phone numbers:', error.response?.data || error.message);
    const isCredentialError = error.message?.includes('credentials') || error.message?.includes('No ');
    res.status(isCredentialError ? 404 : (error.response?.status || 500)).json({
      success: false,
      message: error.message || 'Failed to list phone numbers',
      error: error.response?.data || error.message
    });
  }
});

/**
 * @swagger
 * /superadmin/telephony/numbers/search:
 *   get:
 *     summary: Search available phone numbers to rent
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [platform, client]
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *       - in: query
 *         name: countryISO
 *         schema:
 *           type: string
 *         description: Country ISO code (e.g. US, IN)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [local, tollfree, mobile]
 *       - in: query
 *         name: pattern
 *         schema:
 *           type: string
 *         description: Number pattern to search for
 *     responses:
 *       200:
 *         description: Available phone numbers
 */
router.get('/numbers/search', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const creds = await resolveCredentials(provider, source, clientId);

    const countryISO = req.query.countryISO || 'US';
    const numberType = req.query.type || 'local';
    const mode = req.query.mode || 'discover'; // 'discover' = groups overview, 'load' = specific group
    const prefix = req.query.prefix || '';

    // Single scan: fetch up to `limit` numbers, return all pre-grouped by city
    const limit = parseInt(req.query.limit) || 1000;
    const startOffset = parseInt(req.query.offset) || 0;

    if (provider === 'plivo') {
      const perPage = 20;
      const maxPages = Math.ceil(limit / perPage);
      let offset = startOffset;
      let hasMore = true;
      const allNumbers = [];

      // Get total count first
      const metaResp = await plivoRequest('GET', creds.authId, creds.authToken, '/PhoneNumber/', null, {
        country_iso: countryISO, type: numberType, limit: 1
      });
      const totalAvailable = metaResp.data.meta?.total_count || 0;

      for (let page = 0; page < maxPages && hasMore && allNumbers.length < limit; page++) {
        const resp = await plivoRequest('GET', creds.authId, creds.authToken, '/PhoneNumber/', null, {
          country_iso: countryISO, type: numberType, limit: perPage, offset
        });
        const objects = resp.data.objects || [];
        objects.forEach(n => {
          if (allNumbers.length < limit) {
            allNumbers.push({
              number: n.number, country: n.country || countryISO,
              type: n.type || numberType, monthlyRentalRate: n.monthly_rental_rate || '',
              region: n.region || 'Other', setupRate: n.setup_rate || ''
            });
          }
        });
        hasMore = objects.length === perPage;
        offset += perPage;
      }

      // Group by region
      const groups = {};
      allNumbers.forEach(n => {
        const region = n.region;
        if (!groups[region]) {
          groups[region] = { region, prefix: n.number.substring(0, 4), monthlyRentalRate: n.monthlyRentalRate, numbers: [] };
        }
        groups[region].numbers.push(n);
      });

      const groupList = Object.values(groups)
        .map(g => {
          // Score each number and sort by rarity (rarest first)
          g.numbers = g.numbers.map(n => ({
            ...n,
            rarityScore: computeRarityScore(n.number)
          })).sort((a, b) => b.rarityScore - a.rarityScore);
          // Group's best score = its rarest number
          g.bestScore = g.numbers.length > 0 ? g.numbers[0].rarityScore : 0;
          g.count = g.numbers.length;
          return g;
        })
        .sort((a, b) => b.bestScore - a.bestScore);

      return res.status(200).json({
        success: true,
        data: { groups: groupList, totalAvailable, totalFetched: allNumbers.length, hasMore: allNumbers.length >= limit && allNumbers.length < totalAvailable }
      });
    } else {
      // Twilio — supports up to 1000 in Limit
      const numberTypePath = numberType === 'tollfree' ? 'TollFree' :
                             numberType === 'mobile' ? 'Mobile' : 'Local';
      const resp = await twilioRequest('GET', creds.accountSid, creds.authToken,
        `/AvailablePhoneNumbers/${countryISO}/${numberTypePath}.json`, null, { Limit: Math.min(limit, 1000) });
      const allNumbers = (resp.data.available_phone_numbers || []).map(n => ({
        number: n.phone_number, country: countryISO, type: numberType,
        region: n.region || n.locality || 'Other'
      }));

      const groups = {};
      allNumbers.forEach(n => {
        const region = n.region;
        if (!groups[region]) {
          groups[region] = { region, prefix: n.number.replace(/^\+/, '').substring(0, 4), numbers: [] };
        }
        groups[region].numbers.push(n);
      });

      const groupList = Object.values(groups)
        .map(g => {
          // Score each number and sort by rarity (rarest first)
          g.numbers = g.numbers.map(n => ({
            ...n,
            rarityScore: computeRarityScore(n.number)
          })).sort((a, b) => b.rarityScore - a.rarityScore);
          // Group's best score = its rarest number
          g.bestScore = g.numbers.length > 0 ? g.numbers[0].rarityScore : 0;
          g.count = g.numbers.length;
          return g;
        })
        .sort((a, b) => b.bestScore - a.bestScore);

      return res.status(200).json({
        success: true,
        data: { groups: groupList, totalAvailable: allNumbers.length, totalFetched: allNumbers.length, hasMore: false }
      });
    }
  } catch (error) {
    console.error('Error searching phone numbers:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: 'Failed to search phone numbers',
      error: error.response?.data || error.message
    });
  }
});

/**
 * @swagger
 * /superadmin/telephony/numbers/rent:
 *   post:
 *     summary: Rent (buy) a phone number
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *               source:
 *                 type: string
 *                 enum: [platform, client]
 *               clientId:
 *                 type: string
 *               number:
 *                 type: string
 *                 description: Phone number to rent
 *               appId:
 *                 type: string
 *                 description: Application ID to associate (optional)
 *     responses:
 *       200:
 *         description: Number rented successfully
 */
router.post('/numbers/rent', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const creds = await resolveCredentials(provider, source, clientId);
    const { number, appId } = req.body;

    if (!number) {
      return res.status(400).json({ success: false, message: 'number is required' });
    }

    let result;

    if (provider === 'plivo') {
      const data = { numbers: number };
      if (appId) data.app_id = appId;

      const resp = await plivoRequest('POST', creds.authId, creds.authToken, '/PhoneNumber/', data);
      result = {
        status: resp.data.status || 'fulfilled',
        numbers: resp.data.numbers || [{ number }],
        message: resp.data.message || 'Number rented successfully'
      };
    } else {
      // Twilio - purchase a number
      const data = { PhoneNumber: number };
      if (appId) data.VoiceApplicationSid = appId;

      const resp = await twilioRequest('POST', creds.accountSid, creds.authToken, '/IncomingPhoneNumbers.json', data);
      result = {
        sid: resp.data.sid,
        number: resp.data.phone_number,
        friendlyName: resp.data.friendly_name,
        status: 'fulfilled',
        message: 'Number purchased successfully'
      };
    }

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error renting phone number:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: 'Failed to rent phone number',
      error: error.response?.data || error.message
    });
  }
});

/**
 * @swagger
 * /superadmin/telephony/numbers/release:
 *   post:
 *     summary: Release (delete) a phone number
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *               source:
 *                 type: string
 *                 enum: [platform, client]
 *               clientId:
 *                 type: string
 *               number:
 *                 type: string
 *                 description: Phone number to release (for Plivo) or SID (for Twilio)
 *     responses:
 *       200:
 *         description: Number released successfully
 */
router.post('/numbers/release', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const creds = await resolveCredentials(provider, source, clientId);
    const { number } = req.body;

    if (!number) {
      return res.status(400).json({ success: false, message: 'number is required' });
    }

    if (provider === 'plivo') {
      // Plivo: unrent a number - DELETE /Number/{number}/
      await plivoRequest('DELETE', creds.authId, creds.authToken, `/Number/${number}/`);
    } else {
      // Twilio: release a number - need the SID
      // If a SID is given directly (starts with PN), use it; otherwise look it up
      let phoneSid = number;
      if (!number.startsWith('PN')) {
        // Look up the SID by phone number
        const resp = await twilioRequest('GET', creds.accountSid, creds.authToken, '/IncomingPhoneNumbers.json', null, {
          PhoneNumber: number
        });
        const nums = resp.data.incoming_phone_numbers || [];
        if (nums.length === 0) {
          return res.status(404).json({ success: false, message: `Phone number ${number} not found in account` });
        }
        phoneSid = nums[0].sid;
      }
      await twilioRequest('DELETE', creds.accountSid, creds.authToken, `/IncomingPhoneNumbers/${phoneSid}.json`);
    }

    // Also remove any assignments for this number
    const collection = await getAssignmentsCollection();
    await collection.deleteMany({ number: number });

    res.status(200).json({ success: true, data: { number, message: 'Number released successfully' } });
  } catch (error) {
    console.error('Error releasing phone number:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: 'Failed to release phone number',
      error: error.response?.data || error.message
    });
  }
});

// ==================== NUMBER ASSIGNMENTS ====================

/**
 * @swagger
 * /superadmin/telephony/numbers/assign:
 *   post:
 *     summary: Assign a phone number to an agent
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *               - agentId
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *               source:
 *                 type: string
 *                 enum: [platform, client]
 *               clientId:
 *                 type: string
 *               number:
 *                 type: string
 *                 description: Phone number to assign
 *               agentId:
 *                 type: string
 *                 description: Agent/assistant ID to assign the number to
 *     responses:
 *       200:
 *         description: Number assigned to agent
 */
router.post('/numbers/assign', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const { number, agentId } = req.body;

    if (!number || !agentId) {
      return res.status(400).json({ success: false, message: 'number and agentId are required' });
    }

    const collection = await getAssignmentsCollection();

    // Check if this number is already assigned
    const existing = await collection.findOne({ number });
    if (existing) {
      // Update existing assignment
      await collection.updateOne(
        { number },
        {
          $set: {
            agentId,
            provider,
            source,
            clientId: clientId || null,
            updatedAt: new Date()
          }
        }
      );
    } else {
      // Create new assignment
      await collection.insertOne({
        number,
        agentId,
        provider,
        source,
        clientId: clientId || null,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    res.status(200).json({
      success: true,
      data: {
        number,
        agentId,
        provider,
        source,
        clientId,
        message: 'Number assigned to agent successfully'
      }
    });
  } catch (error) {
    console.error('Error assigning phone number:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to assign phone number',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /superadmin/telephony/numbers/unassign:
 *   post:
 *     summary: Unassign a phone number from an agent
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *             properties:
 *               number:
 *                 type: string
 *                 description: Phone number to unassign
 *     responses:
 *       200:
 *         description: Number unassigned
 */
router.post('/numbers/unassign', async (req, res) => {
  try {
    const { number } = req.body;

    if (!number) {
      return res.status(400).json({ success: false, message: 'number is required' });
    }

    const collection = await getAssignmentsCollection();
    const result = await collection.deleteOne({ number });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'No assignment found for this number' });
    }

    res.status(200).json({
      success: true,
      data: { number, message: 'Number unassigned successfully' }
    });
  } catch (error) {
    console.error('Error unassigning phone number:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to unassign phone number',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /superadmin/telephony/assignments:
 *   get:
 *     summary: List all phone number assignments
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *         description: Filter by provider
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [platform, client]
 *         description: Filter by source
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *         description: Filter by client ID
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: string
 *         description: Filter by agent ID
 *     responses:
 *       200:
 *         description: List of phone number assignments
 */
router.get('/assignments', async (req, res) => {
  try {
    const collection = await getAssignmentsCollection();

    // Build filter from query params
    const filter = {};
    if (req.query.provider) filter.provider = req.query.provider.toLowerCase();
    if (req.query.source) filter.source = req.query.source.toLowerCase();
    if (req.query.clientId) filter.clientId = req.query.clientId;
    if (req.query.agentId) filter.agentId = req.query.agentId;

    const assignments = await collection
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();

    res.status(200).json({ success: true, data: assignments });
  } catch (error) {
    console.error('Error listing assignments:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to list assignments',
      error: error.message
    });
  }
});

// ==================== APPLICATIONS ====================

/**
 * @swagger
 * /superadmin/telephony/apps:
 *   get:
 *     summary: List telephony applications
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [platform, client]
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of applications
 */
router.get('/apps', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const creds = await resolveCredentials(provider, source, clientId);

    let apps = [];

    if (provider === 'plivo') {
      const resp = await plivoRequest('GET', creds.authId, creds.authToken, '/Application/', null, {
        limit: 100
      });
      apps = (resp.data.objects || []).map(a => ({
        appId: a.app_id,
        appName: a.app_name,
        answerUrl: a.answer_url || '',
        answerMethod: a.answer_method || 'POST',
        hangupUrl: a.hangup_url || '',
        fallbackUrl: a.fallback_answer_url || '',
        created: a.created || '',
        modified: a.modified || ''
      }));
    } else {
      // Twilio - list applications
      const resp = await twilioRequest('GET', creds.accountSid, creds.authToken, '/Applications.json');
      apps = (resp.data.applications || []).map(a => ({
        appId: a.sid,
        appName: a.friendly_name || '',
        voiceUrl: a.voice_url || '',
        voiceMethod: a.voice_method || 'POST',
        statusCallback: a.status_callback || '',
        smsUrl: a.sms_url || '',
        dateCreated: a.date_created || '',
        dateUpdated: a.date_updated || ''
      }));
    }

    res.status(200).json({ success: true, data: apps });
  } catch (error) {
    console.error('Error listing apps:', error.response?.data || error.message);
    const isCredentialError = error.message?.includes('credentials') || error.message?.includes('No ');
    res.status(isCredentialError ? 404 : (error.response?.status || 500)).json({
      success: false,
      message: error.message || 'Failed to list applications',
      error: error.response?.data || error.message
    });
  }
});

/**
 * @swagger
 * /superadmin/telephony/apps:
 *   post:
 *     summary: Create a telephony application
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - appName
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *               source:
 *                 type: string
 *                 enum: [platform, client]
 *               clientId:
 *                 type: string
 *               appName:
 *                 type: string
 *                 description: Application name
 *               answerUrl:
 *                 type: string
 *                 description: URL to call when a call is answered
 *               answerMethod:
 *                 type: string
 *                 enum: [GET, POST]
 *                 default: POST
 *               hangupUrl:
 *                 type: string
 *                 description: URL to call on hangup
 *               fallbackUrl:
 *                 type: string
 *                 description: Fallback URL
 *     responses:
 *       201:
 *         description: Application created
 */
router.post('/apps', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const creds = await resolveCredentials(provider, source, clientId);
    const { appName, answerUrl, answerMethod, hangupUrl, fallbackUrl } = req.body;

    if (!appName) {
      return res.status(400).json({ success: false, message: 'appName is required' });
    }

    let result;

    if (provider === 'plivo') {
      const data = {
        app_name: appName,
        answer_method: answerMethod || 'POST'
      };
      if (answerUrl) data.answer_url = answerUrl;
      if (hangupUrl) data.hangup_url = hangupUrl;
      if (fallbackUrl) data.fallback_answer_url = fallbackUrl;

      const resp = await plivoRequest('POST', creds.authId, creds.authToken, '/Application/', data);
      result = {
        appId: resp.data.app_id,
        appName: appName,
        message: resp.data.message || 'Application created successfully'
      };
    } else {
      // Twilio - create application
      const data = {
        FriendlyName: appName,
        VoiceMethod: answerMethod || 'POST'
      };
      if (answerUrl) data.VoiceUrl = answerUrl;
      if (hangupUrl) data.StatusCallback = hangupUrl;
      if (fallbackUrl) data.VoiceFallbackUrl = fallbackUrl;

      const resp = await twilioRequest('POST', creds.accountSid, creds.authToken, '/Applications.json', data);
      result = {
        appId: resp.data.sid,
        appName: resp.data.friendly_name,
        message: 'Application created successfully'
      };
    }

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('Error creating app:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: 'Failed to create application',
      error: error.response?.data || error.message
    });
  }
});

/**
 * @swagger
 * /superadmin/telephony/apps/{appId}:
 *   delete:
 *     summary: Delete a telephony application
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appId
 *         required: true
 *         schema:
 *           type: string
 *         description: Application ID to delete
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [platform, client]
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Application deleted
 */
router.delete('/apps/:appId', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const creds = await resolveCredentials(provider, source, clientId);
    const { appId } = req.params;

    if (provider === 'plivo') {
      await plivoRequest('DELETE', creds.authId, creds.authToken, `/Application/${appId}/`);
    } else {
      // Twilio
      await twilioRequest('DELETE', creds.accountSid, creds.authToken, `/Applications/${appId}.json`);
    }

    res.status(200).json({
      success: true,
      data: { appId, message: 'Application deleted successfully' }
    });
  } catch (error) {
    console.error('Error deleting app:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: 'Failed to delete application',
      error: error.response?.data || error.message
    });
  }
});

// ==================== ACCOUNT ====================

/**
 * @swagger
 * /superadmin/telephony/account/balance:
 *   get:
 *     summary: Get provider account balance
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [platform, client]
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account balance info
 */
router.get('/account/balance', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const creds = await resolveCredentials(provider, source, clientId);

    let balance = null;

    if (provider === 'plivo') {
      const resp = await plivoRequest('GET', creds.authId, creds.authToken, '/');
      balance = {
        credits: resp.data.cash_credits || '0',
        currency: 'USD',
        autoRecharge: resp.data.auto_recharge || false
      };
    } else {
      // Twilio
      const resp = await twilioRequest('GET', creds.accountSid, creds.authToken, '.json');
      balance = {
        credits: resp.data.balance || '0',
        currency: resp.data.currency || 'USD',
        status: resp.data.status
      };
    }

    res.status(200).json({ success: true, data: balance });
  } catch (error) {
    const isCredentialError = error.message?.includes('credentials') || error.message?.includes('No ');
    res.status(isCredentialError ? 404 : 500).json({
      success: false, message: error.message
    });
  }
});

// ==================== NUMBER-APP LINKING ====================

/**
 * @swagger
 * /superadmin/telephony/numbers/link-app:
 *   post:
 *     summary: Link a phone number to a telephony application
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *               - appId
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *               source:
 *                 type: string
 *                 enum: [platform, client]
 *               clientId:
 *                 type: string
 *               number:
 *                 type: string
 *                 description: Phone number to link
 *               appId:
 *                 type: string
 *                 description: Application ID to link to
 *     responses:
 *       200:
 *         description: Number linked to app
 */
router.post('/numbers/link-app', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const { number, appId } = req.body;
    if (!number || !appId) {
      return res.status(400).json({ success: false, message: 'number and appId are required' });
    }

    const creds = await resolveCredentials(provider, source, clientId);

    if (provider === 'plivo') {
      await plivoRequest('POST', creds.authId, creds.authToken, `/Number/${number}/`, {
        app_id: appId
      });
    } else {
      // Twilio: need to look up the number SID first, then update voice_url
      // Get the app's voice_url
      const appResp = await twilioRequest('GET', creds.accountSid, creds.authToken, `/Applications/${appId}.json`);
      const voiceUrl = appResp.data.voice_url;

      // Look up number SID
      const numbersResp = await twilioRequest('GET', creds.accountSid, creds.authToken, '/IncomingPhoneNumbers.json', null, { PhoneNumber: number });
      const phoneRecord = (numbersResp.data.incoming_phone_numbers || [])[0];
      if (!phoneRecord) {
        return res.status(404).json({ success: false, message: `Number ${number} not found in account` });
      }

      await twilioRequest('POST', creds.accountSid, creds.authToken, `/IncomingPhoneNumbers/${phoneRecord.sid}.json`, {
        VoiceUrl: voiceUrl,
        VoiceMethod: 'POST'
      });
    }

    res.status(200).json({ success: true, data: { number, appId, message: 'Number linked to app' } });
  } catch (error) {
    console.error('Error linking number to app:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ success: false, message: error.message });
  }
});

// ==================== ONE-CLICK ASSIGN/UNASSIGN ====================

/**
 * @swagger
 * /superadmin/telephony/numbers/assign-agent:
 *   post:
 *     summary: One-click assign - create app, link number, save assignment
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *               - agentId
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *               source:
 *                 type: string
 *                 enum: [platform, client]
 *               clientId:
 *                 type: string
 *               number:
 *                 type: string
 *                 description: Phone number to assign
 *               agentId:
 *                 type: string
 *                 description: Agent/assistant ID
 *               agentName:
 *                 type: string
 *                 description: Agent display name (used for app naming)
 *     responses:
 *       200:
 *         description: Agent assigned to number with app created and linked
 */
router.post('/numbers/assign-agent', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const { number, agentId, agentName } = req.body;

    if (!number || !agentId) {
      return res.status(400).json({ success: false, message: 'number and agentId are required' });
    }

    const creds = await resolveCredentials(provider, source, clientId);

    // Fetch the agent from MongoDB to get its wssUrl
    await connectToMongo();
    const database = client.db('talkGlimpass');
    const assistantsCollection = database.collection('assistant');
    const agent = await assistantsCollection.findOne({ _id: new ObjectId(agentId) });

    if (!agent) {
      return res.status(404).json({ success: false, message: `Agent ${agentId} not found` });
    }

    const wssUrl = agent.wssUrl || `wss://socket.glimpass.com/chat/v2/${agentId}`;
    const resolvedAgentName = agentName || agent.agent_name || 'agent';
    const resolvedClientId = clientId || agent.clientId || '';
    const baseUrl = process.env.BASE_URL || 'https://api.markaible.com';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    let appId, appName, answerUrl, hangupUrl;
    let reusedExistingApp = false;
    // Sanitize agent name for Plivo app name (only letters, numbers, -, _)
    const safeName = resolvedAgentName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');

    if (provider === 'plivo') {
      answerUrl = `${baseUrl}/ip/xml-plivo?wss=${wssUrl}`;
      hangupUrl = `${baseUrl}/plivo/hangup-url?campId=incoming`;

      // Check if an app already exists for this agent (by matching agentId in answer_url)
      try {
        const appsResp = await plivoRequest('GET', creds.authId, creds.authToken, '/Application/', null, { limit: 100 });
        const existingApp = (appsResp.data.objects || []).find(app => {
          return (app.answer_url || '').includes(agentId);
        });
        if (existingApp) {
          appId = existingApp.app_id;
          appName = existingApp.app_name;
          reusedExistingApp = true;
          console.log(`♻️ Reusing existing app ${appId} (${appName}) for agent ${agentId}`);
        }
      } catch (e) { /* ignore, will create new */ }

      if (!appId) {
        appName = `${safeName}_${timestamp}`;
        const appResp = await plivoRequest('POST', creds.authId, creds.authToken, '/Application/', {
          app_name: appName,
          answer_url: answerUrl,
          hangup_url: hangupUrl,
          answer_method: 'POST'
        });
        appId = appResp.data.app_id;
        console.log(`✅ Created new app ${appId} (${appName}) for agent ${agentId}`);
      }

      // Link number to application
      await plivoRequest('POST', creds.authId, creds.authToken, `/Number/${number}/`, {
        app_id: appId
      });
    } else {
      // Twilio
      answerUrl = `${baseUrl}/twilio/twiml?wss=${wssUrl}`;
      hangupUrl = `${baseUrl}/twilio/status-callback`;

      // Check if app already exists for this agent
      try {
        const appsResp = await twilioRequest('GET', creds.accountSid, creds.authToken, '/Applications.json');
        const existingApp = (appsResp.data.applications || []).find(app => {
          return (app.voice_url || '').includes(agentId);
        });
        if (existingApp) {
          appId = existingApp.sid;
          appName = existingApp.friendly_name;
          answerUrl = existingApp.voice_url;
          reusedExistingApp = true;
        }
      } catch (e) { /* ignore */ }

      if (!appId) {
        appName = `${safeName}_${timestamp}`;
        const appResp = await twilioRequest('POST', creds.accountSid, creds.authToken, '/Applications.json', {
          FriendlyName: appName,
          VoiceUrl: answerUrl,
          VoiceMethod: 'POST',
          StatusCallback: hangupUrl
        });
        appId = appResp.data.sid;
      }

      // Look up number SID then link
      const numbersResp = await twilioRequest('GET', creds.accountSid, creds.authToken, '/IncomingPhoneNumbers.json', null, { PhoneNumber: number });
      const phoneRecord = (numbersResp.data.incoming_phone_numbers || [])[0];
      if (!phoneRecord) {
        return res.status(404).json({ success: false, message: `Number ${number} not found in account` });
      }

      await twilioRequest('POST', creds.accountSid, creds.authToken, `/IncomingPhoneNumbers/${phoneRecord.sid}.json`, {
        VoiceUrl: answerUrl,
        VoiceMethod: 'POST'
      });
    }

    // Save assignment to MongoDB
    const assignmentsCol = await getAssignmentsCollection();
    const assignment = {
      number,
      agentId,
      agentName: resolvedAgentName,
      clientId: resolvedClientId,
      provider,
      source,
      appId,
      appName,
      answerUrl,
      hangupUrl,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Upsert: if number already has an assignment, update it
    await assignmentsCol.updateOne(
      { number },
      { $set: assignment },
      { upsert: true }
    );

    res.status(200).json({ success: true, data: assignment });
  } catch (error) {
    console.error('Error in assign-agent:', error.response?.data || error.message);
    const isCredentialError = error.message?.includes('credentials') || error.message?.includes('No ');
    res.status(isCredentialError ? 404 : (error.response?.status || 500)).json({
      success: false,
      message: error.message,
      error: error.response?.data || error.message
    });
  }
});

/**
 * @swagger
 * /superadmin/telephony/numbers/unassign-agent:
 *   post:
 *     summary: Reverse of assign-agent - delete app, unlink number, remove assignment
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [plivo, twilio]
 *               source:
 *                 type: string
 *                 enum: [platform, client]
 *               clientId:
 *                 type: string
 *               number:
 *                 type: string
 *                 description: Phone number to unassign
 *     responses:
 *       200:
 *         description: Agent unassigned, app deleted, number unlinked
 */
router.post('/numbers/unassign-agent', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const { number } = req.body;

    if (!number) {
      return res.status(400).json({ success: false, message: 'number is required' });
    }

    // Look up assignment in MongoDB
    const assignmentsCol = await getAssignmentsCollection();
    const assignment = await assignmentsCol.findOne({ number });

    if (!assignment) {
      return res.status(404).json({ success: false, message: 'No assignment found for this number' });
    }

    const creds = await resolveCredentials(provider, source, clientId);

    if (assignment.appId) {
      if (provider === 'plivo') {
        // Unlink number from app first
        try {
          await plivoRequest('POST', creds.authId, creds.authToken, `/Number/${number}/`, {
            app_id: ''
          });
        } catch (unlinkErr) {
          console.error('Error unlinking number from Plivo app:', unlinkErr.response?.data || unlinkErr.message);
        }

        // Delete the application
        try {
          await plivoRequest('DELETE', creds.authId, creds.authToken, `/Application/${assignment.appId}/`);
        } catch (deleteErr) {
          console.error('Error deleting Plivo app:', deleteErr.response?.data || deleteErr.message);
        }
      } else {
        // Twilio: clear voice_url on number
        try {
          const numbersResp = await twilioRequest('GET', creds.accountSid, creds.authToken, '/IncomingPhoneNumbers.json', null, { PhoneNumber: number });
          const phoneRecord = (numbersResp.data.incoming_phone_numbers || [])[0];
          if (phoneRecord) {
            await twilioRequest('POST', creds.accountSid, creds.authToken, `/IncomingPhoneNumbers/${phoneRecord.sid}.json`, {
              VoiceUrl: '',
              VoiceMethod: 'POST'
            });
          }
        } catch (unlinkErr) {
          console.error('Error clearing Twilio voice URL:', unlinkErr.response?.data || unlinkErr.message);
        }

        // Delete the Twilio application
        try {
          await twilioRequest('DELETE', creds.accountSid, creds.authToken, `/Applications/${assignment.appId}.json`);
        } catch (deleteErr) {
          console.error('Error deleting Twilio app:', deleteErr.response?.data || deleteErr.message);
        }
      }
    }

    // Remove assignment from MongoDB
    await assignmentsCol.deleteOne({ number });

    res.status(200).json({
      success: true,
      data: { number, message: 'Agent unassigned, app deleted, and number unlinked successfully' }
    });
  } catch (error) {
    console.error('Error in unassign-agent:', error.response?.data || error.message);
    const isCredentialError = error.message?.includes('credentials') || error.message?.includes('No ');
    res.status(isCredentialError ? 404 : (error.response?.status || 500)).json({
      success: false,
      message: error.message,
      error: error.response?.data || error.message
    });
  }
});

// ==================== PRICING ====================

/**
 * @swagger
 * /superadmin/telephony/numbers/pricing:
 *   get:
 *     summary: Get phone number pricing by country
 *     tags: [Superadmin Telephony]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [plivo, twilio]
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [platform, client]
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *       - in: query
 *         name: countryISO
 *         schema:
 *           type: string
 *         description: Country ISO code (e.g. US, IN)
 *     responses:
 *       200:
 *         description: Number pricing info
 */
router.get('/numbers/pricing', async (req, res) => {
  try {
    const { provider, source, clientId } = extractParams(req);
    const { countryISO } = req.query;
    const creds = await resolveCredentials(provider, source, clientId);

    let pricing = null;

    if (provider === 'plivo') {
      const resp = await plivoRequest('GET', creds.authId, creds.authToken, '/PhoneNumber/', null, {
        country_iso: countryISO || 'IN',
        limit: 1
      });
      // Plivo returns pricing in the search results
      const sample = (resp.data.objects || [])[0];
      pricing = {
        country: countryISO || 'IN',
        monthlyRate: sample?.monthly_rental_rate || 'N/A',
        setupRate: sample?.setup_rate || '0',
        currency: 'USD'
      };
    } else {
      // Twilio pricing API
      const resp = await twilioRequest('GET', creds.accountSid, creds.authToken, '', null, null);
      pricing = {
        country: countryISO || 'US',
        monthlyRate: 'varies',
        currency: 'USD'
      };
    }

    res.status(200).json({ success: true, data: pricing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
