/**
 * Test script for Flows API endpoints
 *
 * Usage:
 *   node test-flows-api.js
 *
 * Make sure the server is running and you have a valid JWT token
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const JWT_TOKEN = process.env.JWT_TOKEN || ''; // Set this to a valid token

// Test credentials - replace with valid credentials from your database
const TEST_EMAIL = 'test@glimpass.com';
const TEST_PASSWORD = 'testpassword123';

const api = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json'
    },
    validateStatus: () => true // Don't throw on any status
});

let authToken = JWT_TOKEN;

async function login() {
    if (authToken) {
        console.log('Using provided JWT token...');
        return;
    }

    console.log('\n=== Testing Login ===');
    const response = await api.post('/interlogue/get-client', {
        email: TEST_EMAIL,
        password: TEST_PASSWORD
    });

    if (response.status === 200 && response.data.token) {
        authToken = response.data.token;
        console.log('Login successful!');
        console.log('Token:', authToken.substring(0, 20) + '...');
    } else {
        console.error('Login failed:', response.data);
        process.exit(1);
    }
}

async function testAgentFlowLookup() {
    console.log('\n=== Testing GET /api/flows/agent/:agentId ===');

    const testAgentIds = [
        '69320c340633f489136754ef', // Known agent with flow
        'nonexistent_agent_id'       // Agent without flow
    ];

    for (const agentId of testAgentIds) {
        console.log(`\nTesting agent ID: ${agentId}`);
        const response = await api.get(`/api/flows/agent/${agentId}`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        console.log('Status:', response.status);
        console.log('Response:', JSON.stringify(response.data, null, 2));
    }
}

async function testGetFlowData() {
    console.log('\n=== Testing GET /api/flows/:flowName ===');

    const testFlows = [
        'neetprep_lead_qualifier',  // Known flow
        'nonexistent_flow'          // Flow that doesn't exist
    ];

    for (const flowName of testFlows) {
        console.log(`\nTesting flow: ${flowName}`);
        const response = await api.get(`/api/flows/${flowName}`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        console.log('Status:', response.status);
        if (response.status === 200) {
            console.log('Flow name:', response.data.name);
            console.log('Meta:', JSON.stringify(response.data.meta, null, 2));
            console.log('Prompts:', Object.keys(response.data.prompts));
            console.log('Configs:', Object.keys(response.data.configs));
        } else {
            console.log('Response:', JSON.stringify(response.data, null, 2));
        }
    }
}

async function testUpdatePrompt() {
    console.log('\n=== Testing PUT /api/flows/:flowName/prompts/:promptName ===');

    const flowName = 'neetprep_lead_qualifier';
    const promptName = 'test_prompt';
    const content = 'This is a test prompt content - ' + new Date().toISOString();

    console.log(`\nUpdating prompt: ${flowName}/${promptName}`);
    const response = await api.put(
        `/api/flows/${flowName}/prompts/${promptName}`,
        { content: content },
        { headers: { Authorization: `Bearer ${authToken}` } }
    );

    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));

    // Verify the update
    if (response.status === 200) {
        console.log('\nVerifying update by fetching flow data...');
        const verifyResponse = await api.get(`/api/flows/${flowName}`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        if (verifyResponse.status === 200) {
            const savedContent = verifyResponse.data.prompts[promptName];
            console.log('Saved content matches:', savedContent === content);
        }
    }
}

async function testUpdateConfig() {
    console.log('\n=== Testing PUT /api/flows/:flowName/configs/:configName ===');

    const flowName = 'neetprep_lead_qualifier';
    const configName = 'test_config';
    const value = 'test_value_' + Date.now();

    console.log(`\nUpdating config: ${flowName}/${configName}`);
    const response = await api.put(
        `/api/flows/${flowName}/configs/${configName}`,
        { value: value },
        { headers: { Authorization: `Bearer ${authToken}` } }
    );

    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));

    // Verify the update
    if (response.status === 200) {
        console.log('\nVerifying update by fetching flow data...');
        const verifyResponse = await api.get(`/api/flows/${flowName}`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        if (verifyResponse.status === 200) {
            const savedValue = verifyResponse.data.configs[configName];
            console.log('Saved value matches:', savedValue === value);
        }
    }
}

async function testWithoutAuth() {
    console.log('\n=== Testing Without Authentication ===');

    console.log('\nTrying to access protected endpoint without token...');
    const response = await api.get('/api/flows/agent/test_agent');

    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('Should be 401 Unauthorized');
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('FLOWS API TEST SUITE');
    console.log('='.repeat(60));
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Date: ${new Date().toISOString()}`);

    try {
        // Login first
        await login();

        // Run tests
        await testAgentFlowLookup();
        await testGetFlowData();
        await testUpdatePrompt();
        await testUpdateConfig();
        await testWithoutAuth();

        console.log('\n' + '='.repeat(60));
        console.log('ALL TESTS COMPLETED');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('TEST FAILED');
        console.error('='.repeat(60));
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        process.exit(1);
    }
}

// Run tests
runTests();
