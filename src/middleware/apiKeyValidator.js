
const { connectToMongo, closeMongoConnection, client } = require('./../../models/mongodb.js');



module.exports = async function apiKeyValidator(req, res, next) {
  const apiKey = req.header("x-api-key");

  if (!apiKey) {
    return res.status(401).json({ error: "API key missing" });
  }

  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const clientCollection = database.collection("client");
    const clientData = await clientCollection.findOne({ apiKey });

    if (!clientData) {
      return res.status(403).json({ error: "Invalid API key" });
    }

    req.clientData = clientData;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({ error: "Authentication failed" });
  }
};