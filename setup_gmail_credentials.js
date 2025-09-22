#!/usr/bin/env node

const axios = require('axios');

/**
 * Setup Gmail credentials for testing
 * Note: In production, you would use real Gmail App Password
 */

const CLIENT_ID = '688d42040633f48913672d43';
const BASE_URL = 'http://localhost:7999';
const SUPER_KEY = 'test_super_key_for_tools_api_admin_access_2024';

async function setupGmailCredentials() {
  console.log('📧 Setting up Gmail credentials for testing...');
  console.log(`🏢 Client ID: ${CLIENT_ID}`);
  console.log('');

  try {
    // Add email credentials via telephony credentials API
    const credentialsData = {
      clientId: CLIENT_ID,
      provider: 'email',
      gmail_user: 'test@gmail.com',  // Replace with real email
      gmail_password: 'test_app_password'  // Replace with real Gmail App Password
    };

    console.log('🔧 Adding Gmail SMTP credentials...');
    const response = await axios.post(`${BASE_URL}/api/telephony-credentials/add`, credentialsData, {
      headers: {
        'Authorization': `Bearer ${SUPER_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Gmail credentials added successfully!');
    console.log('📋 Response:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('❌ Error setting up Gmail credentials:', error.message);
    if (error.response) {
      console.error('📤 Response status:', error.response.status);
      console.error('📤 Response data:', JSON.stringify(error.response.data, null, 2));
    }

    console.log('');
    console.log('💡 Alternative approach - check if endpoint exists:');

    // Try to list available endpoints
    try {
      console.log('🔍 Testing telephony credentials endpoints...');

      // Try different endpoint formats
      const endpoints = [
        '/api/telephony-credentials/add',
        '/api/telephony-credentials',
        '/api/credentials/add',
        '/api/tools/email/credentials'
      ];

      for (const endpoint of endpoints) {
        try {
          const testResponse = await axios.get(`${BASE_URL}${endpoint}`, {
            headers: { 'Authorization': `Bearer ${SUPER_KEY}` }
          });
          console.log(`✅ Endpoint ${endpoint} exists`);
        } catch (testError) {
          if (testError.response?.status === 404) {
            console.log(`❌ Endpoint ${endpoint} not found`);
          } else if (testError.response?.status === 405) {
            console.log(`⚠️  Endpoint ${endpoint} exists but method not allowed`);
          } else {
            console.log(`🤔 Endpoint ${endpoint} - Status: ${testError.response?.status}`);
          }
        }
      }

    } catch (testError) {
      console.log('🔍 Could not test endpoints');
    }
  }
}

async function testCredentialsAfterSetup() {
  console.log('');
  console.log('🧪 Testing Gmail credentials after setup...');

  try {
    // Test Gmail configuration
    const testResponse = await axios.post(`${BASE_URL}/api/tools/gmail/test-config`, {
      client_id: CLIENT_ID,
      test_email: 'rishiraj.ccs@gmail.com'
    }, {
      headers: {
        'Authorization': `Bearer ${SUPER_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Gmail configuration test successful!');
    console.log('📋 Test result:', JSON.stringify(testResponse.data, null, 2));

  } catch (error) {
    console.error('❌ Gmail configuration test failed:', error.message);
    if (error.response) {
      console.error('📤 Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run setup
async function main() {
  console.log('🚀 Gmail Credentials Setup');
  console.log('=' .repeat(50));

  await setupGmailCredentials();
  await testCredentialsAfterSetup();

  console.log('');
  console.log('🏁 Gmail credentials setup completed!');
  console.log('');
  console.log('📝 Next steps:');
  console.log('   1. Verify credentials are added correctly');
  console.log('   2. Test joke email sending again');
  console.log('   3. Replace with real Gmail App Password for production');
  console.log('');
  console.log('💡 To get Gmail App Password:');
  console.log('   1. Enable 2FA on Gmail account');
  console.log('   2. Go to Google Account settings > Security > App passwords');
  console.log('   3. Generate new app password for "Mail"');
  console.log('   4. Use that password instead of regular Gmail password');
}

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Setup failed:', error.message);
    process.exit(1);
  });
}

module.exports = { setupGmailCredentials, testCredentialsAfterSetup };