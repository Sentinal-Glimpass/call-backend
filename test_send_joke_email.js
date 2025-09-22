#!/usr/bin/env node

const axios = require('axios');

/**
 * Test script to send a joke email to rishiraj.ccs@gmail.com
 */

const AGENT_ID = '678782afa8d9072894be7ca9';
const CLIENT_ID = '688d42040633f48913672d43';
const BASE_URL = 'http://localhost:7999';
const SUPER_KEY = 'test_super_key_for_tools_api_admin_access_2024';

const jokes = [
  "Why don't scientists trust atoms? Because they make up everything! 😄",
  "Why did the programmer quit his job? He didn't get arrays! 💻",
  "Why do Java developers wear glasses? Because they can't C#! 👓",
  "What's the best thing about Switzerland? I don't know, but the flag is a big plus! 🇨🇭",
  "Why don't eggs tell jokes? They'd crack each other up! 🥚"
];

async function sendJokeEmail() {
  console.log('📧 Attempting to send joke email to rishiraj.ccs@gmail.com...');
  console.log('');

  try {
    // Pick a random joke
    const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];

    // Create email content
    const emailSubject = '🎭 A Programming Joke from Your MCP Server!';
    const emailBody = `
Hello Rishi! 👋

Here's a fun joke from your Gmail MCP server integration:

${randomJoke}

This email was sent automatically via the Gmail MCP server to test the integration.

Best regards,
Your Gmail MCP Server 🤖

---
Sent via Claude Code + Gmail MCP Integration
Agent ID: ${AGENT_ID}
Client ID: ${CLIENT_ID}
Timestamp: ${new Date().toISOString()}
    `.trim();

    // Create MCP tool call request
    const toolCallRequest = {
      method: 'tools/call',
      params: {
        name: 'gmail_send_email',
        arguments: {
          client_id: CLIENT_ID,
          to: 'rishiraj.ccs@gmail.com',
          subject: emailSubject,
          body: emailBody,
          html: false
        }
      },
      jsonrpc: '2.0',
      id: 1
    };

    console.log('🎭 Selected joke:', randomJoke);
    console.log('📤 Sending email via Gmail MCP server...');
    console.log('📦 Request details:');
    console.log(`   Subject: ${emailSubject}`);
    console.log(`   To: rishiraj.ccs@gmail.com`);
    console.log(`   Body length: ${emailBody.length} characters`);
    console.log('');

    // Send the request
    const response = await axios.post(`${BASE_URL}/mcp/gmail/${AGENT_ID}`, toolCallRequest, {
      headers: {
        'Authorization': `Bearer ${SUPER_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Gmail MCP server response received!');
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
          console.log('🎉 Joke email sent successfully to rishiraj.ccs@gmail.com!');
          if (parsedResult.data) {
            console.log(`📧 Message ID: ${parsedResult.data.message_id || 'N/A'}`);
            console.log(`📬 Recipient: ${parsedResult.data.recipient || 'rishiraj.ccs@gmail.com'}`);
          }
        } else {
          console.log('❌ Email failed:', parsedResult.error || 'Unknown error');

          // If credentials are missing, provide helpful info
          if (parsedResult.error?.includes('credentials') || parsedResult.error?.includes('Gmail')) {
            console.log('');
            console.log('💡 Looks like Gmail credentials are not configured yet!');
            console.log('   To fix this, you need to:');
            console.log('   1. Add Gmail SMTP credentials to the telephony credentials system');
            console.log('   2. Use Gmail App Password (not regular password)');
            console.log('   3. Ensure the credentials are for the correct client ID');
          }
        }
      } catch (parseError) {
        console.log('📨 Raw result text:', resultText);
      }
    }

  } catch (error) {
    console.error('❌ Error sending joke email:', error.message);
    if (error.response) {
      console.error('📤 Response status:', error.response.status);
      console.error('📤 Response data:', JSON.stringify(error.response.data, null, 2));

      // Handle specific error cases
      if (error.response.status === 404) {
        console.log('');
        console.log('💡 Gmail MCP server endpoint not found or no Gmail tools assigned.');
        console.log('   This means Gmail tools are not configured for this agent yet.');
      }
    }
  }
}

// Also test just the tools/list to see what's available
async function checkAvailableTools() {
  try {
    console.log('🔍 Checking available Gmail tools...');

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

    console.log('📋 Available Gmail tools:', response.data.result?.tools?.length || 0);
    if (response.data.result?.tools?.length > 0) {
      response.data.result.tools.forEach((tool, index) => {
        console.log(`   ${index + 1}. ${tool.name} - ${tool.description}`);
      });
    }
    console.log('');

  } catch (error) {
    console.log('ℹ️  No Gmail tools available (this is expected if not configured yet)');
    console.log('');
  }
}

// Run the test
async function main() {
  console.log('🚀 Starting joke email test...');
  console.log('=' .repeat(50));

  // First check what tools are available
  await checkAvailableTools();

  // Then try to send the email
  await sendJokeEmail();

  console.log('');
  console.log('🏁 Joke email test completed!');
}

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Test failed:', error.message);
    process.exit(1);
  });
}

module.exports = { sendJokeEmail, checkAvailableTools };