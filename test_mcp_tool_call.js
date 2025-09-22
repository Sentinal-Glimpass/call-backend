#!/usr/bin/env node

const axios = require('axios');

async function testMCPToolCall() {
  try {
    console.log('🧪 Testing MCP Tool Call...');

    // Test the exact same call that Claude made, but with template name parameter
    const mcpRequest = {
      "method": "tools/call",
      "params": {
        "name": "whatsapp_messenger",
        "arguments": {
          "recipient": "+919608848421",
          // Add template parameters if the template needs them
          // Based on the template name "20th_sept_canada_webinar", it likely doesn't need variables
        }
      },
      "jsonrpc": "2.0",
      "id": 1
    };

    console.log('📤 Sending MCP request:', JSON.stringify(mcpRequest, null, 2));

    // Call the MCP server endpoint
    const response = await axios.post('http://localhost:7999/mcp/wati/678782afa8d9072894be7ca9', mcpRequest, {
      headers: {
        'Authorization': 'Bearer test_super_key_for_tools_api_admin_access_2024',
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ MCP Response received');
    console.log('📨 Response:', JSON.stringify(response.data, null, 2));

    // Parse the result content
    if (response.data.result && response.data.result.content) {
      const contentText = response.data.result.content[0].text;
      const result = JSON.parse(contentText);

      console.log('\n📋 Parsed Result:');
      console.log('Success:', result.success);
      console.log('Message:', result.message || result.error);

      if (result.success) {
        console.log('🎉 WhatsApp message sent successfully!');
        console.log('Message ID:', result.data.message_id);
        console.log('Recipient:', result.data.recipient);
        console.log('Template:', result.data.template_name);
      } else {
        console.log('❌ Message failed:', result.error);

        // If it's a 401 error, let's debug the credentials
        if (result.error.includes('401')) {
          console.log('\n🔍 Debugging 401 error...');
          console.log('This indicates authentication failure with WATI API');
          console.log('Possible issues:');
          console.log('1. API key expired or invalid');
          console.log('2. Wrong tenant ID in URL');
          console.log('3. Missing Bearer prefix in API key');
        }
      }
    }

  } catch (error) {
    console.error('❌ Error testing MCP tool call:', error.response?.data || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    }
  }
}

// Run the test
testMCPToolCall();