const axios = require('axios');

const BASE_URL = 'http://localhost:7999';
const AGENT_ID = '678782afa8d9072894be7ca9';

async function testTemplateVariableReplacement() {
  console.log('🧪 Testing Template Variable Replacement');
  console.log('==================================================');

  try {
    // Test with specific name and content values
    const testCases = [
      {
        name: 'John Doe',
        content: 'This is a test message to verify template variables are working correctly!'
      },
      {
        name: 'Alice Smith',
        content: 'Hello! This email tests the {content} variable replacement in the email body template.'
      },
      {
        name: 'Bob Wilson',
        content: 'Testing special characters: @#$%^&*()_+ and emojis 🎉🚀✅'
      }
    ];

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];

      console.log(`\n📧 Test Case ${i + 1}:`);
      console.log(`   Name: "${testCase.name}"`);
      console.log(`   Content: "${testCase.content}"`);
      console.log(`   Expected Subject: "${testCase.name}, hope to make you smile"`);

      const toolCallRequest = {
        method: 'tools/call',
        params: {
          name: 'send_email',
          arguments: {
            to: 'rishiraj.ccs@gmail.com',
            name: testCase.name,
            content: testCase.content
          }
        },
        jsonrpc: '2.0',
        id: i + 1
      };

      console.log('📤 Sending email...');

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

      if (response.data.result && response.data.result.content) {
        const result = JSON.parse(response.data.result.content[0].text);

        console.log('✅ Email sent successfully!');
        console.log(`📧 Message ID: ${result.data.message_id}`);
        console.log(`📬 Recipient: ${result.data.to}`);
        console.log(`📝 Actual Subject: "${result.data.subject}"`);

        // Verify template replacement
        const expectedSubject = `${testCase.name}, hope to make you smile`;
        if (result.data.subject === expectedSubject) {
          console.log('✅ Subject template replacement: CORRECT');
        } else {
          console.log('❌ Subject template replacement: FAILED');
          console.log(`   Expected: "${expectedSubject}"`);
          console.log(`   Actual: "${result.data.subject}"`);
        }
      } else {
        console.log('❌ Unexpected response format');
      }

      // Wait 1 second between tests
      if (i < testCases.length - 1) {
        console.log('⏳ Waiting 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

  } catch (error) {
    console.error('❌ Error during template variable test:', error.message);
    if (error.response) {
      console.error('📨 Response:', error.response.data);
    }
  }

  console.log('\n🏁 Template variable replacement test completed!');
}

testTemplateVariableReplacement();