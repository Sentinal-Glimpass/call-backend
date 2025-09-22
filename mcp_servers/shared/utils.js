const axios = require('axios');

/**
 * Shared utilities for MCP servers
 */

/**
 * Make HTTP request to internal API
 */
async function makeInternalAPIRequest(endpoint, options = {}) {
  const baseURL = process.env.INTERNAL_API_BASE_URL || 'http://localhost:7999';

  const config = {
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPER_KEY}`,
      ...options.headers
    },
    ...options
  };

  try {
    const response = await axios(endpoint, config);
    return response.data;
  } catch (error) {
    console.error(`API request failed: ${endpoint}`, error.response?.data || error.message);
    throw new Error(`API request failed: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Get client credentials for a specific provider
 */
async function getClientCredentials(clientId, provider) {
  try {
    const response = await makeInternalAPIRequest(`/telephony-credentials/${clientId}/${provider}`, {
      method: 'GET'
    });

    if (!response.success) {
      throw new Error(`No ${provider} credentials found for client: ${clientId}`);
    }

    return response.credentials;
  } catch (error) {
    throw new Error(`Failed to get ${provider} credentials: ${error.message}`);
  }
}

/**
 * Validate template variables against provided variables
 */
function validateTemplateVariables(templateVariables = [], providedVariables = {}) {
  const missing = templateVariables.filter(variable =>
    !(variable in providedVariables)
  );

  if (missing.length > 0) {
    throw new Error(`Missing required template variables: ${missing.join(', ')}`);
  }

  return true;
}

/**
 * Replace template variables in text
 */
function replaceTemplateVariables(text, variables = {}) {
  let result = text;

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value || '');
  });

  return result;
}

/**
 * Parse and validate email address
 */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error(`Invalid email address: ${email}`);
  }
  return true;
}

/**
 * Parse and validate phone number (international format)
 */
function validatePhoneNumber(phone) {
  // Remove all non-digits for validation
  const digitsOnly = phone.replace(/\D/g, '');

  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    throw new Error(`Invalid phone number: ${phone}. Must be 10-15 digits.`);
  }

  return true;
}

/**
 * Format response for MCP tools
 */
function formatMCPResponse(success, data, message = '', error = null) {
  const response = {
    success,
    timestamp: new Date().toISOString(),
  };

  if (success) {
    response.data = data;
    if (message) response.message = message;
  } else {
    response.error = error || 'Unknown error occurred';
    if (message) response.message = message;
  }

  return response;
}

/**
 * Create JSON schema for MCP tool input
 */
function createMCPSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
  };
}

module.exports = {
  makeInternalAPIRequest,
  getClientCredentials,
  validateTemplateVariables,
  replaceTemplateVariables,
  validateEmail,
  validatePhoneNumber,
  formatMCPResponse,
  createMCPSchema,
};