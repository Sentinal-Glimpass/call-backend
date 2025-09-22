const { connectToMongo, client } = require('../models/mongodb.js');

/**
 * Initialize Tools Database Collections
 *
 * This script creates collections for the tool-specific architecture:
 * 1. watiTools - WATI tool configurations
 * 2. agentWatiTools - Agent WATI tool assignments
 * 3. emailTools - Email tool configurations
 * 4. agentEmailTools - Agent email tool assignments
 * 5. mcpTools - Generic MCP tool configurations
 * 6. agentMcpTools - Agent MCP tool assignments
 */

async function initToolsDatabase() {
  try {
    console.log('🚀 Initializing Tools Database Collections...');

    await connectToMongo();
    const db = client.db('glimpass');

    // =============================================================================
    // 1. WATI TOOLS COLLECTION
    // =============================================================================

    console.log('📱 Creating watiTools collection...');

    const watiToolsExists = await db.listCollections({ name: 'watiTools' }).hasNext();
    if (!watiToolsExists) {
      await db.createCollection('watiTools');
      console.log('✅ watiTools collection created');
    } else {
      console.log('ℹ️  watiTools collection already exists');
    }

    // Create indexes for watiTools
    await db.collection('watiTools').createIndexes([
      { key: { client_id: 1, tool_name: 1 }, unique: true, name: 'client_tool_unique' },
      { key: { client_id: 1 }, name: 'client_id_index' },
      { key: { template_id: 1 }, name: 'template_id_index' },
      { key: { enabled: 1 }, name: 'enabled_index' },
      { key: { strategy: 1 }, name: 'strategy_index' },
      { key: { created_at: 1 }, name: 'created_at_index' }
    ]);
    console.log('📇 watiTools indexes created');

    // =============================================================================
    // 2. AGENT WATI TOOLS COLLECTION
    // =============================================================================

    console.log('🤖 Creating agentWatiTools collection...');

    const agentWatiToolsExists = await db.listCollections({ name: 'agentWatiTools' }).hasNext();
    if (!agentWatiToolsExists) {
      await db.createCollection('agentWatiTools');
      console.log('✅ agentWatiTools collection created');
    } else {
      console.log('ℹ️  agentWatiTools collection already exists');
    }

    // Create indexes for agentWatiTools
    await db.collection('agentWatiTools').createIndexes([
      { key: { agent_id: 1 }, unique: true, name: 'agent_id_unique' },
      { key: { client_id: 1 }, name: 'client_id_index' },
      { key: { 'assigned_tools.wati_tool_id': 1 }, name: 'wati_tool_id_index' },
      { key: { 'assigned_tools.enabled': 1 }, name: 'assigned_enabled_index' },
      { key: { updated_at: 1 }, name: 'updated_at_index' }
    ]);
    console.log('📇 agentWatiTools indexes created');

    // =============================================================================
    // 3. EMAIL TOOLS COLLECTION
    // =============================================================================

    console.log('📧 Creating emailTools collection...');

    const emailToolsExists = await db.listCollections({ name: 'emailTools' }).hasNext();
    if (!emailToolsExists) {
      await db.createCollection('emailTools');
      console.log('✅ emailTools collection created');
    } else {
      console.log('ℹ️  emailTools collection already exists');
    }

    // Create indexes for emailTools
    await db.collection('emailTools').createIndexes([
      { key: { client_id: 1, tool_name: 1 }, unique: true, name: 'client_tool_unique' },
      { key: { client_id: 1 }, name: 'client_id_index' },
      { key: { email_type: 1 }, name: 'email_type_index' },
      { key: { enabled: 1 }, name: 'enabled_index' },
      { key: { strategy: 1 }, name: 'strategy_index' },
      { key: { created_at: 1 }, name: 'created_at_index' }
    ]);
    console.log('📇 emailTools indexes created');

    // =============================================================================
    // 4. AGENT EMAIL TOOLS COLLECTION
    // =============================================================================

    console.log('🤖 Creating agentEmailTools collection...');

    const agentEmailToolsExists = await db.listCollections({ name: 'agentEmailTools' }).hasNext();
    if (!agentEmailToolsExists) {
      await db.createCollection('agentEmailTools');
      console.log('✅ agentEmailTools collection created');
    } else {
      console.log('ℹ️  agentEmailTools collection already exists');
    }

    // Create indexes for agentEmailTools
    await db.collection('agentEmailTools').createIndexes([
      { key: { agent_id: 1 }, unique: true, name: 'agent_id_unique' },
      { key: { client_id: 1 }, name: 'client_id_index' },
      { key: { 'assigned_tools.email_tool_id': 1 }, name: 'email_tool_id_index' },
      { key: { 'assigned_tools.enabled': 1 }, name: 'assigned_enabled_index' },
      { key: { updated_at: 1 }, name: 'updated_at_index' }
    ]);
    console.log('📇 agentEmailTools indexes created');

    // =============================================================================
    // 5. EMAIL TEMPLATES COLLECTION
    // =============================================================================

    console.log('📧 Creating emailTemplates collection...');

    const emailTemplatesExists = await db.listCollections({ name: 'emailTemplates' }).hasNext();
    if (!emailTemplatesExists) {
      await db.createCollection('emailTemplates');
      console.log('✅ emailTemplates collection created');
    } else {
      console.log('ℹ️  emailTemplates collection already exists');
    }

    // Create indexes for emailTemplates
    await db.collection('emailTemplates').createIndexes([
      { key: { client_id: 1, template_name: 1 }, unique: true, name: 'client_template_unique' },
      { key: { client_id: 1 }, name: 'client_id_index' },
      { key: { template_type: 1 }, name: 'template_type_index' },
      { key: { created_at: 1 }, name: 'created_at_index' },
      { key: { template_name: 1 }, name: 'template_name_index' }
    ]);
    console.log('📇 emailTemplates indexes created');

    // =============================================================================
    // 6. MCP TOOLS COLLECTION
    // =============================================================================

    console.log('🔧 Creating mcpTools collection...');

    const mcpToolsExists = await db.listCollections({ name: 'mcpTools' }).hasNext();
    if (!mcpToolsExists) {
      await db.createCollection('mcpTools');
      console.log('✅ mcpTools collection created');
    } else {
      console.log('ℹ️  mcpTools collection already exists');
    }

    // Create indexes for mcpTools
    await db.collection('mcpTools').createIndexes([
      { key: { client_id: 1, tool_name: 1 }, unique: true, name: 'client_tool_unique' },
      { key: { client_id: 1 }, name: 'client_id_index' },
      { key: { mcp_identifier: 1 }, name: 'mcp_identifier_index' },
      { key: { enabled: 1 }, name: 'enabled_index' },
      { key: { strategy: 1 }, name: 'strategy_index' },
      { key: { created_at: 1 }, name: 'created_at_index' }
    ]);
    console.log('📇 mcpTools indexes created');

    // =============================================================================
    // 7. AGENT MCP TOOLS COLLECTION
    // =============================================================================

    console.log('🤖 Creating agentMcpTools collection...');

    const agentMcpToolsExists = await db.listCollections({ name: 'agentMcpTools' }).hasNext();
    if (!agentMcpToolsExists) {
      await db.createCollection('agentMcpTools');
      console.log('✅ agentMcpTools collection created');
    } else {
      console.log('ℹ️  agentMcpTools collection already exists');
    }

    // Create indexes for agentMcpTools
    await db.collection('agentMcpTools').createIndexes([
      { key: { agent_id: 1 }, unique: true, name: 'agent_id_unique' },
      { key: { client_id: 1 }, name: 'client_id_index' },
      { key: { 'assigned_tools.mcp_tool_id': 1 }, name: 'mcp_tool_id_index' },
      { key: { 'assigned_tools.enabled': 1 }, name: 'assigned_enabled_index' },
      { key: { updated_at: 1 }, name: 'updated_at_index' }
    ]);
    console.log('📇 agentMcpTools indexes created');

    // =============================================================================
    // VERIFICATION
    // =============================================================================

    console.log('\n🔍 Verifying collections...');

    const collections = await db.listCollections().toArray();
    const toolsCollections = collections.filter(col =>
      ['watiTools', 'agentWatiTools', 'emailTools', 'agentEmailTools', 'emailTemplates', 'mcpTools', 'agentMcpTools'].includes(col.name)
    );

    console.log('📊 Created collections:');
    for (const collection of toolsCollections) {
      const count = await db.collection(collection.name).countDocuments();
      const indexes = await db.collection(collection.name).listIndexes().toArray();
      console.log(`  ✅ ${collection.name}: ${count} documents, ${indexes.length} indexes`);
    }

    console.log('\n🎉 Tools Database initialization completed successfully!');

    // Show usage instructions
    console.log('\n📖 Usage Instructions:');
    console.log('1. Use /api/tools/wati/* for WATI WhatsApp messaging tools');
    console.log('2. Use /api/tools/gmail/* for Gmail/SMTP email tools');
    console.log('3. Use /api/tools/mcp/* for generic MCP (Model Context Protocol) tools');
    console.log('4. Each tool type has its own service and collection structure');
    console.log('5. Agents can be assigned multiple tools of each type');
    console.log('6. Bot integration provides encrypted credentials per tool type');
    console.log('\n📚 API Documentation available at: /api-docs');

  } catch (error) {
    console.error('❌ Error initializing Tools database:', error);
    throw error;
  } finally {
    // Close connection
    if (client) {
      await client.close();
      console.log('🔌 Database connection closed');
    }
  }
}

// Helper function to show collection schemas
async function showCollectionSchemas() {
  console.log('\n📋 Collection Schemas:\n');

  console.log('1. watiTools:');
  console.log(`{
  _id: ObjectId,
  client_id: "client_123",
  tool_name: "urgent_support_wati",
  description: "Urgent customer support messages",
  template_id: "urgent_support_template",
  language: "en",
  variables: ["customer_name", "issue_type"],
  strategy: "immediate",
  conditions: ["high_priority", "customer_complaint"],
  enabled: true,
  template_info: {
    category: "UTILITY",
    status: "APPROVED"
  },
  created_at: Date,
  updated_at: Date
}`);

  console.log('\n2. agentWatiTools:');
  console.log(`{
  _id: ObjectId,
  agent_id: "agent_123",
  client_id: "client_123",
  assigned_tools: [{
    wati_tool_id: ObjectId,
    enabled: true,
    conditions_override: ["emergency_only"],
    parameters_override: {language: "es"}
  }],
  created_at: Date,
  updated_at: Date
}`);

  console.log('\n3. emailTools:');
  console.log(`{
  _id: ObjectId,
  client_id: "client_123",
  tool_name: "welcome_email",
  description: "Welcome new users",
  email_type: "welcome",
  subject: "Welcome to {{company_name}}!",
  body: "Hi {{user_name}}, welcome to our platform...",
  variables: ["user_name", "company_name", "login_url"],
  strategy: "immediate",
  conditions: ["user_registered"],
  enabled: true,
  created_at: Date,
  updated_at: Date
}`);

  console.log('\n4. agentEmailTools:');
  console.log(`{
  _id: ObjectId,
  agent_id: "agent_123",
  client_id: "client_123",
  assigned_tools: [{
    email_tool_id: ObjectId,
    enabled: true,
    conditions_override: ["vip_user_only"],
    parameters_override: {subject: "VIP Welcome!"}
  }],
  created_at: Date,
  updated_at: Date
}`);
}

// Helper function to add sample data
async function addSampleData() {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    console.log('📝 Adding sample data...');

    // Sample WATI tool
    const sampleWatiTool = {
      client_id: 'sample_client_123',
      tool_name: 'sample_urgent_support',
      description: 'Sample urgent customer support WATI tool',
      template_id: 'urgent_support_template',
      language: 'en',
      variables: ['customer_name', 'issue_type', 'response_time'],
      strategy: 'immediate',
      conditions: ['high_priority', 'customer_complaint'],
      enabled: true,
      template_info: {
        category: 'UTILITY',
        status: 'APPROVED'
      },
      created_at: new Date(),
      updated_at: new Date()
    };

    // Sample Email tool
    const sampleEmailTool = {
      client_id: 'sample_client_123',
      tool_name: 'sample_welcome_email',
      description: 'Sample welcome email for new users',
      email_type: 'welcome',
      subject: 'Welcome to {{company_name}}!',
      body: 'Hi {{user_name}},\n\nWelcome to our platform! We\'re excited to have you on board.\n\nYour login URL: {{login_url}}\n\nBest regards,\n{{company_name}} Team',
      variables: ['user_name', 'company_name', 'login_url'],
      strategy: 'immediate',
      conditions: ['user_registered'],
      enabled: true,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Insert sample tools if they don't exist
    const watiCount = await db.collection('watiTools').countDocuments({ client_id: 'sample_client_123' });
    if (watiCount === 0) {
      await db.collection('watiTools').insertOne(sampleWatiTool);
      console.log('✅ Sample WATI tool added');
    }

    const emailCount = await db.collection('emailTools').countDocuments({ client_id: 'sample_client_123' });
    if (emailCount === 0) {
      await db.collection('emailTools').insertOne(sampleEmailTool);
      console.log('✅ Sample email tool added');
    }

  } catch (error) {
    console.error('❌ Error adding sample data:', error);
  }
}

// Run initialization if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const addSamples = args.includes('--samples');

  initToolsDatabase()
    .then(async () => {
      if (addSamples) {
        await addSampleData();
      }
      console.log('✅ Database initialization completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Database initialization failed:', error);
      process.exit(1);
    });
}

module.exports = {
  initToolsDatabase,
  showCollectionSchemas,
  addSampleData
};