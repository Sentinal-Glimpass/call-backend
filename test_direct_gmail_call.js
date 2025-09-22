#!/usr/bin/env node

const axios = require('axios');

/**
 * Direct test of Gmail MCP server without tool assignment
 * This bypasses the agent tool assignment and tests Gmail functionality directly
 */

const CLIENT_ID = '688d42040633f48913672d43';
const BASE_URL = 'http://localhost:7999';

async function testDirectGmailCall() {
  console.log('📧 Testing direct Gmail API call...');

  try {
    // Test Gmail configuration endpoint directly
    const testConfigRequest = {
      client_id: CLIENT_ID,
      test_email: 'rishiraj.ccs@gmail.com'
    };

    console.log('🔧 Testing Gmail configuration...');
    const response = await axios.post(`${BASE_URL}/api/tools/gmail/test-config`, testConfigRequest, {
      headers: {
        'Authorization': 'Bearer test_super_key_for_tools_api_admin_access_2024',
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Gmail test config response:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('❌ Gmail test config failed:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }

    // If credentials are missing, let's try to understand what's needed
    console.log('');
    console.log('💡 Gmail credentials might be missing. Let me check telephony credentials...');

    // Check what provider endpoints are available
    try {
      const credentialsResponse = await axios.get(`${BASE_URL}/api/telephony-credentials/${CLIENT_ID}`, {
        headers: {
          'Authorization': 'Bearer test_super_key_for_tools_api_admin_access_2024'
        }
      });

      console.log('📋 Available credentials:', JSON.stringify(credentialsResponse.data, null, 2));
    } catch (credError) {
      console.log('ℹ️  Could not fetch credentials, endpoint might not be available');
    }
  }
}

async function tryDirectEmailSend() {
  console.log('');
  console.log('📧 Attempting to send joke email directly via Gmail service...');

  const emailData = {
    client_id: CLIENT_ID,
    to: 'rishiraj.ccs@gmail.com',
    subject: '🎭 Direct Gmail Test - Programming Joke!',
    body: `
Hello Rishi! 👋

Here's a programming joke sent directly via Gmail service:

Why do programmers prefer dark mode?
Because light attracts bugs! 🐛💡

This email was sent via direct Gmail service call to test the integration.

Best regards,
Your Gmail Service 🤖

---
Direct Gmail Service Test
Client ID: ${CLIENT_ID}
Timestamp: ${new Date().toISOString()}
    `.trim(),
    html: false
  };

  try {
    // Try to send email via the Gmail service directly
    const response = await axios.post(`${BASE_URL}/api/tools/gmail/send`, emailData, {
      headers: {
        'Authorization': 'Bearer test_super_key_for_tools_api_admin_access_2024',
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Direct email send successful!');
    console.log('📧 Response:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('❌ Direct email send failed:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run tests
async function main() {
  console.log('🚀 Testing Direct Gmail Service...');
  console.log('=' .repeat(50));

  await testDirectGmailCall();
  await tryDirectEmailSend();

  console.log('');
  console.log('🏁 Direct Gmail tests completed!');
  console.log('');
  console.log('💡 If both tests failed, you need to:');
  console.log('   1. Configure Gmail SMTP credentials (username + app password)');
  console.log('   2. Add credentials via telephony credentials API');
  console.log('   3. Ensure Gmail MCP server has access to credentials');
}

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Tests failed:', error.message);
    process.exit(1);
  });
}

module.exports = { testDirectGmailCall, tryDirectEmailSend };