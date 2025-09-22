const axios = require('axios');

const BASE_URL = 'http://localhost:7999';
const AGENT_ID = '678782afa8d9072894be7ca9';
const CLIENT_ID = '688d42040633f48913672d43';

async function testUserEmailTool() {
  console.log('📧 Testing user-created email tool...');
  console.log('==================================================');

  try {
    // Test the user-created email tool
    const toolCallRequest = {
      method: 'tools/call',
      params: {
        name: 'send_email',
        arguments: {
          to: 'rishiraj.ccs@gmail.com',
          name: 'Rishi',
          content: 'Here is a test email from the updated Gmail MCP server with only your custom send_email tool! 🎉\n\nThis proves the dynamic parameter loading is working correctly with your template variables.'
        }
      },
      jsonrpc: '2.0',
      id: 1
    };

    console.log('📤 Sending email via user tool...');
    console.log('📦 Request:', JSON.stringify(toolCallRequest, null, 2));

    const response = await axios.post(
      `${BASE_URL}/mcp/gmail/${AGENT_ID}`,
      toolCallRequest,
      {
        headers: {
          'Authorization': 'Bearer test_super_key_for_tools_api_admin_access_2024',
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Gmail MCP server response received!');
    console.log('📨 Response:', JSON.stringify(response.data, null, 2));

    if (response.data.result && response.data.result.content) {
      const result = JSON.parse(response.data.result.content[0].text);
      console.log('\n📋 Parsed Result:');
      console.log(`Success: ${result.success}`);
      console.log(`Message: ${result.message}`);

      if (result.success) {
        console.log('🎉 Email sent successfully to rishiraj.ccs@gmail.com!');
        console.log(`📧 Message ID: ${result.data.message_id}`);
        console.log(`📬 Recipient: ${result.data.to}`);
        console.log(`📝 Subject: ${result.data.subject}`);
      }
    }

  } catch (error) {
    console.error('❌ Error testing user email tool:', error.message);
    if (error.response) {
      console.error('📨 Response:', error.response.data);
    }
  }

  console.log('\n🏁 User email tool test completed!');
}

testUserEmailTool();