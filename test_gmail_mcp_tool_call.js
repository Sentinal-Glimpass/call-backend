#!/usr/bin/env node

const axios = require('axios');

/**
 * Gmail MCP Tool Test Script
 * Tests Gmail MCP server functionality for agent 678782afa8d9072894be7ca9
 */

const AGENT_ID = '678782afa8d9072894be7ca9';
const CLIENT_ID = '688d42040633f48913672d43';
const BASE_URL = 'http://localhost:7999';
const SUPER_KEY = 'test_super_key_for_tools_api_admin_access_2024';

async function testGmailMCPServer() {
  console.log('🧪 Testing Gmail MCP Server...');
  console.log(`📋 Agent ID: ${AGENT_ID}`);
  console.log(`🏢 Client ID: ${CLIENT_ID}`);
  console.log('');

  try {
    // Step 1: Check MCP configuration
    console.log('📡 Step 1: Checking MCP Configuration...');
    const mcpConfigResponse = await axios.get(`${BASE_URL}/api/bot-integration/${AGENT_ID}/mcp-config`, {
      headers: {
        'Authorization': `Bearer ${SUPER_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('📊 MCP Config Response:', JSON.stringify(mcpConfigResponse.data, null, 2));

    // Check if Gmail server is configured
    const gmailServer = mcpConfigResponse.data.mcp_servers?.find(server =>
      server.name.includes('gmail') || server.tool_type === 'gmail'
    );

    if (!gmailServer) {
      console.log('⚠️  No Gmail MCP server found in configuration');
      console.log('ℹ️  This means no Gmail tools are assigned to this agent yet.');
      console.log('');

      // Test direct Gmail MCP server endpoint anyway
      console.log('🔧 Step 2: Testing Direct Gmail MCP Server Endpoint...');
      await testDirectGmailMCPEndpoint();
      return;
    }

    console.log('✅ Gmail MCP server found:', gmailServer.name);
    console.log('');

    // Step 2: Test Gmail MCP tools/list
    console.log('📋 Step 2: Testing Gmail MCP tools/list...');
    await testGmailToolsList();

    // Step 3: Test Gmail MCP tool call
    console.log('📧 Step 3: Testing Gmail MCP tool call...');
    await testGmailToolCall();

  } catch (error) {
    console.error('❌ Error testing Gmail MCP server:', error.message);
    if (error.response) {
      console.error('📤 Response status:', error.response.status);
      console.error('📤 Response data:', error.response.data);
    }
  }
}

async function testDirectGmailMCPEndpoint() {
  try {
    // Test tools/list on Gmail MCP server
    const toolsListRequest = {
      method: 'tools/list',
      jsonrpc: '2.0',
      id: 1
    };

    console.log('📤 Sending tools/list request to Gmail MCP server...');
    console.log('📦 Request:', JSON.stringify(toolsListRequest, null, 2));

    const response = await axios.post(`${BASE_URL}/mcp/gmail/${AGENT_ID}`, toolsListRequest, {
      headers: {
        'Authorization': `Bearer ${SUPER_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Gmail MCP tools/list response:');
    console.log('📨 Response:', JSON.stringify(response.data, null, 2));
    console.log('');

    // If tools are available, test a simple email send
    if (response.data.result?.tools?.length > 0) {
      const availableTools = response.data.result.tools;
      console.log(`🔧 Found ${availableTools.length} Gmail tools available`);

      // Try to find a simple email tool
      const emailTool = availableTools.find(tool =>
        tool.name === 'gmail_send_email' || tool.name.includes('email')
      );

      if (emailTool) {
        console.log(`📧 Testing tool: ${emailTool.name}`);
        await testGmailSimpleEmail(emailTool.name);
      }
    } else {
      console.log('ℹ️  No Gmail tools found - this is expected if no Gmail tools are configured');
    }

  } catch (error) {
    console.error('❌ Error testing direct Gmail MCP endpoint:', error.message);
    if (error.response) {
      console.error('📤 Response status:', error.response.status);
      console.error('📤 Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

async function testGmailToolsList() {
  try {
    const toolsListRequest = {
      method: 'tools/list',
      jsonrpc: '2.0',
      id: 1
    };

    const response = await axios.post(`${BASE_URL}/mcp/gmail/${AGENT_ID}`, toolsListRequest, {
      headers: {
        'Authorization': `Bearer ${SUPER_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Gmail tools/list successful');
    console.log('📨 Available tools:', response.data.result?.tools?.length || 0);

    if (response.data.result?.tools?.length > 0) {
      response.data.result.tools.forEach((tool, index) => {
        console.log(`   ${index + 1}. ${tool.name} - ${tool.description}`);
      });
    }
    console.log('');

  } catch (error) {
    console.error('❌ Gmail tools/list failed:', error.message);
    throw error;
  }
}

async function testGmailToolCall() {
  try {
    await testGmailSimpleEmail('gmail_send_email');
  } catch (error) {
    console.error('❌ Gmail tool call failed:', error.message);
    throw error;
  }
}

async function testGmailSimpleEmail(toolName = 'gmail_send_email') {
  try {
    const toolCallRequest = {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: {
          client_id: CLIENT_ID,
          to: 'test@example.com',
          subject: 'Test Email from Gmail MCP Server',
          body: 'This is a test email sent via the Gmail MCP server integration. If you receive this, the integration is working correctly!',
          html: false
        }
      },
      jsonrpc: '2.0',
      id: 2
    };

    console.log('📤 Sending Gmail tool call request...');
    console.log('📦 Request:', JSON.stringify(toolCallRequest, null, 2));

    const response = await axios.post(`${BASE_URL}/mcp/gmail/${AGENT_ID}`, toolCallRequest, {
      headers: {
        'Authorization': `Bearer ${SUPER_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Gmail tool call response received');
    console.log('📨 Response:', JSON.stringify(response.data, null, 2));

    // Parse the result
    if (response.data.result?.content?.[0]?.text) {
      const resultText = response.data.result.content[0].text;
      try {
        const parsedResult = JSON.parse(resultText);
        console.log('');
        console.log('📋 Parsed Result:');
        console.log(`Success: ${parsedResult.success}`);
        console.log(`Message: ${parsedResult.message}`);

        if (parsedResult.success) {
          console.log('🎉 Email sent successfully!');
          if (parsedResult.data) {
            console.log(`📧 Message ID: ${parsedResult.data.message_id || 'N/A'}`);
            console.log(`📬 Recipient: ${parsedResult.data.recipient || 'N/A'}`);
          }
        } else {
          console.log('❌ Email failed:', parsedResult.error || 'Unknown error');
        }
      } catch (parseError) {
        console.log('📨 Raw result text:', resultText);
      }
    }

  } catch (error) {
    console.error('❌ Gmail simple email test failed:', error.message);
    if (error.response) {
      console.error('📤 Response status:', error.response.status);
      console.error('📤 Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

async function testGmailTemplateEmail() {
  try {
    const toolCallRequest = {
      method: 'tools/call',
      params: {
        name: 'gmail_send_template_email',
        arguments: {
          client_id: CLIENT_ID,
          to: 'test@example.com',
          template_name: 'welcome_template',
          variables: {
            name: 'Test User',
            company: 'Test Company'
          }
        }
      },
      jsonrpc: '2.0',
      id: 3
    };

    console.log('📤 Sending Gmail template email request...');
    console.log('📦 Request:', JSON.stringify(toolCallRequest, null, 2));

    const response = await axios.post(`${BASE_URL}/mcp/gmail/${AGENT_ID}`, toolCallRequest, {
      headers: {
        'Authorization': `Bearer ${SUPER_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Gmail template email response received');
    console.log('📨 Response:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('❌ Gmail template email test failed:', error.message);
    if (error.response) {
      console.error('📤 Response status:', error.response.status);
      console.error('📤 Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Enhanced error handling and debugging
async function debugGmailCredentials() {
  try {
    console.log('🔍 Debugging Gmail Credentials...');

    const response = await axios.get(`${BASE_URL}/api/telephony-credentials/${CLIENT_ID}`, {
      headers: {
        'Authorization': `Bearer ${SUPER_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('📊 Credentials response:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('❌ Failed to debug credentials:', error.message);
    if (error.response) {
      console.error('📤 Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run the test
if (require.main === module) {
  console.log('🚀 Starting Gmail MCP Server Test Suite');
  console.log('=' .repeat(50));

  testGmailMCPServer()
    .then(() => {
      console.log('');
      console.log('🏁 Gmail MCP server test completed!');
      console.log('');
      console.log('💡 Next Steps:');
      console.log('   1. Configure Gmail credentials if not present');
      console.log('   2. Create Gmail tool instances');
      console.log('   3. Assign Gmail tools to agents');
      console.log('   4. Test email sending functionality');
    })
    .catch((error) => {
      console.error('');
      console.error('💥 Test suite failed:', error.message);
      process.exit(1);
    });
}

module.exports = {
  testGmailMCPServer,
  testDirectGmailMCPEndpoint,
  testGmailSimpleEmail,
  testGmailTemplateEmail,
  debugGmailCredentials
};