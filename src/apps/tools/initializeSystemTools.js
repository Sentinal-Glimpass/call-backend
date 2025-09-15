const { createToolRegistry, getToolRegistryById } = require('./tools.js');

/**
 * Initialize system-level tools in the registry
 * This should be run once during system setup
 */
async function initializeSystemTools() {
  console.log('🔧 Initializing system tools registry...');

  const toolsToCreate = [
    {
      name: 'wati_messaging',
      description: 'WATI WhatsApp messaging integration',
      version: '1.0.0',
      provider: 'wati',
      category: 'messaging',
      openai_schema: {
        type: 'function',
        function: {
          name: 'send_wati_message',
          description: 'Send WhatsApp message via WATI using templates',
          parameters: {
            type: 'object',
            properties: {
              recipient: {
                type: 'string',
                description: 'WhatsApp number to send message to (with country code)'
              },
              templateName: {
                type: 'string',
                description: 'WATI template name to use'
              },
              variables: {
                type: 'object',
                description: 'Template variables as key-value pairs'
              }
            },
            required: ['recipient', 'templateName']
          }
        }
      },
      endpoint_config: {
        method: 'POST',
        base_url: 'https://live-mt-server.wati.io',
        path: '/{tenantId}/api/v1/sendTemplateMessage',
        headers: { 'Content-Type': 'application/json' },
        auth_type: 'bearer'
      },
      auth_requirements: ['accessToken'],
      active: true,
      created_at: new Date(),
      created_by: 'system'
    }
  ];

  for (const toolData of toolsToCreate) {
    try {
      // Check if tool already exists
      const existingTool = await getToolRegistryById(toolData.name);

      if (existingTool.status === 200) {
        console.log(`✅ Tool '${toolData.name}' already exists in registry`);
        continue;
      }

      // Create the tool
      const result = await createToolRegistry(toolData);

      if (result.status === 201) {
        console.log(`✅ Created system tool: ${toolData.name}`);
      } else if (result.status === 400 && result.message.includes('already exists')) {
        console.log(`ℹ️ Tool '${toolData.name}' already exists`);
      } else {
        console.error(`❌ Failed to create tool '${toolData.name}':`, result.message);
      }
    } catch (error) {
      console.error(`❌ Error initializing tool '${toolData.name}':`, error.message);
    }
  }

  console.log('🎯 System tools initialization completed');
}

module.exports = { initializeSystemTools };