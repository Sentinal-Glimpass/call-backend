#!/usr/bin/env node

/**
 * Add Phone Number Script
 * Usage: node addNumber.js +1234567890 [provider]
 * 
 * Examples:
 *   node addNumber.js +18787876789                    # Adds with Twilio (default for this script)
 *   node addNumber.js +18787876789 twilio            # Explicitly Twilio
 *   node addNumber.js +18787876789 plivo             # Explicitly Plivo
 */

const PhoneProviderService = require('../src/services/phoneProviderService');

// Color codes for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m', 
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logHeader(message) {
  console.log(`\n${colors.bold}${colors.cyan}=== ${message} ===${colors.reset}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

function logError(message) {
  console.error(`${colors.red}❌ ${message}${colors.reset}`);
}

function logWarning(message) {
  console.warn(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

function showUsage() {
  logHeader('Phone Number Registration Tool');
  console.log(`
${colors.bold}Usage:${colors.reset}
  node addNumber.js <phoneNumber> [provider]

${colors.bold}Examples:${colors.reset}
  ${colors.green}node addNumber.js +18787876789${colors.reset}           # Adds with Twilio (default)
  ${colors.green}node addNumber.js +18787876789 twilio${colors.reset}    # Explicitly Twilio
  ${colors.green}node addNumber.js +18787876789 plivo${colors.reset}     # Explicitly Plivo

${colors.bold}Parameters:${colors.reset}
  ${colors.cyan}phoneNumber${colors.reset}  Phone number with country code (e.g., +1234567890)
  ${colors.cyan}provider${colors.reset}     Provider: 'twilio' or 'plivo' (default: twilio)

${colors.bold}Note:${colors.reset} 
  • This script defaults to Twilio (unlike the system default of Plivo)
  • Perfect for quickly adding Twilio numbers for testing
  • Numbers are stored in MongoDB phoneProviders collection
`);
}

async function validatePhoneNumber(phoneNumber) {
  // Basic phone number validation
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  
  if (!phoneRegex.test(phoneNumber)) {
    return {
      valid: false,
      error: 'Invalid phone number format. Must start with + and contain 2-15 digits.'
    };
  }
  
  return { valid: true };
}

function getProviderConfig(provider) {
  const configs = {
    plivo: {
      accountSid: process.env.PLIVO_ACCOUNT_SID || 'MAMTBIYJUYNMRINGQ4ND',
      authToken: process.env.PLIVO_AUTH_TOKEN || 'default_plivo_token'
    },
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || 'AC_default_twilio_sid', 
      authToken: process.env.TWILIO_AUTH_TOKEN || 'default_twilio_token'
    }
  };
  
  return configs[provider];
}

async function addPhoneNumber(phoneNumber, provider = 'twilio') {
  try {
    logHeader(`Adding Phone Number: ${phoneNumber}`);
    
    // Validate phone number format
    const validation = await validatePhoneNumber(phoneNumber);
    if (!validation.valid) {
      logError(validation.error);
      process.exit(1);
    }
    
    // Validate provider
    if (!['plivo', 'twilio'].includes(provider)) {
      logError(`Invalid provider: ${provider}. Must be 'plivo' or 'twilio'`);
      process.exit(1);
    }
    
    log(`📞 Phone Number: ${phoneNumber}`);
    log(`🏷️  Provider: ${provider.toUpperCase()}`);
    
    // Get provider configuration
    const providerConfig = getProviderConfig(provider);
    log(`🔧 Account SID: ${providerConfig.accountSid}`);
    
    // Check if number already exists
    log(`\n🔍 Checking if number already exists...`);
    const existingProvider = await PhoneProviderService.getProvider(phoneNumber);
    
    if (!existingProvider.isDefault) {
      logWarning(`Number ${phoneNumber} is already mapped to ${existingProvider.provider.toUpperCase()}`);
      
      // Ask if user wants to update
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise((resolve) => {
        rl.question(`Do you want to update it to ${provider.toUpperCase()}? (y/N): `, resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        log('Operation cancelled.');
        process.exit(0);
      }
      
      // Update existing mapping
      log(`\n🔄 Updating existing mapping...`);
      const updateResult = await PhoneProviderService.updateProvider(phoneNumber, {
        provider,
        providerConfig,
        isActive: true
      });
      
      if (updateResult.success) {
        logSuccess(`Phone number ${phoneNumber} updated to ${provider.toUpperCase()} provider!`);
      } else {
        logError(`Failed to update: ${updateResult.error}`);
        process.exit(1);
      }
      
    } else {
      // Add new mapping
      log(`\n➕ Adding new phone number mapping...`);
      const result = await PhoneProviderService.addProvider({
        phoneNumber,
        provider,
        providerConfig
      });
      
      if (result.success) {
        logSuccess(`Phone number ${phoneNumber} successfully added with ${provider.toUpperCase()} provider!`);
        log(`📋 Database ID: ${result.id}`);
      } else {
        logError(`Failed to add phone number: ${result.error}`);
        process.exit(1);
      }
    }
    
    // Verify the mapping
    log(`\n🔍 Verifying mapping...`);
    const verifyProvider = await PhoneProviderService.getProvider(phoneNumber);
    log(`✅ Verification: ${phoneNumber} → ${verifyProvider.provider.toUpperCase()}`);
    log(`🏷️  Account SID: ${verifyProvider.providerConfig?.accountSid || 'N/A'}`);
    log(`🟢 Active: ${verifyProvider.isActive}`);
    
    logHeader('Success! 🎉');
    log(`Phone number ${colors.bold}${phoneNumber}${colors.reset} is now mapped to ${colors.bold}${provider.toUpperCase()}${colors.reset}`);
    log(`\nNext steps:`);
    log(`• Make calls from ${phoneNumber} → Will use ${provider.toUpperCase()}`);  
    log(`• Test: curl "http://localhost:7999/phone-provider/test/${phoneNumber}"`);
    
  } catch (error) {
    logError(`Script error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  // Show usage if no arguments or help requested
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showUsage();
    process.exit(0);
  }
  
  const phoneNumber = args[0];
  const provider = args[1] || 'twilio'; // Default to Twilio for this script
  
  if (!phoneNumber) {
    logError('Phone number is required!');
    showUsage();
    process.exit(1);
  }
  
  await addPhoneNumber(phoneNumber, provider);
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    logError(`Unexpected error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = { addPhoneNumber };