#!/usr/bin/env node
/**
 * Security Check Script
 * Validates environment configuration and common security issues
 */

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');

console.log('🔐 Security Configuration Check');
console.log('================================');

let criticalIssues = 0;
let warnings = 0;

// Check JWT Secret Security
console.log('\n📋 JWT Configuration:');
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.log('❌ CRITICAL: JWT_SECRET not set');
  criticalIssues++;
} else if (jwtSecret.length < 32) {
  console.log('❌ CRITICAL: JWT_SECRET too short (minimum 32 characters)');
  criticalIssues++;
} else if (jwtSecret.includes('change') || jwtSecret.includes('production')) {
  console.log('❌ CRITICAL: JWT_SECRET appears to be default/placeholder');
  criticalIssues++;
} else {
  console.log('✅ JWT_SECRET configured securely');
}

// Check Database Configurations
console.log('\n🗄️ Database Configuration:');
const mongoUri = process.env.MONGODB_URI;
const arangoPassword = process.env.ARANGO_PASSWORD;

if (!mongoUri) {
  console.log('❌ CRITICAL: MONGODB_URI not set');
  criticalIssues++;
} else {
  console.log('✅ MongoDB URI configured');
}

if (!arangoPassword) {
  console.log('⚠️  WARNING: ARANGO_PASSWORD not set');
  warnings++;
} else {
  console.log('✅ ArangoDB password configured');
}

// Check API Keys
console.log('\n🔑 API Keys:');
const requiredKeys = [
  'AZURE_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'TWILIO_AUTH_TOKEN',
  'EXOTEL_AUTH_TOKEN'
];

requiredKeys.forEach(key => {
  if (!process.env[key]) {
    console.log(`⚠️  WARNING: ${key} not set`);
    warnings++;
  } else {
    console.log(`✅ ${key} configured`);
  }
});

// Check for hardcoded secrets in source files
console.log('\n🔍 Source Code Security:');
const sensitivePatterns = [
  /password\s*[:=]\s*['"]\w+['"]/i,
  /secret\s*[:=]\s*['"]\w+['"]/i,
  /token\s*[:=]\s*['"]\w+['"]/i,
  /key\s*[:=]\s*['"]\w+['"]/i
];

let foundHardcodedSecrets = false;
function checkFileForSecrets(filePath) {
  if (!fs.existsSync(filePath)) return;
  
  const content = fs.readFileSync(filePath, 'utf8');
  sensitivePatterns.forEach((pattern, index) => {
    if (pattern.test(content)) {
      console.log(`❌ CRITICAL: Potential hardcoded secret in ${filePath}`);
      foundHardcodedSecrets = true;
      criticalIssues++;
    }
  });
}

// Check key source files (limited check)
const filesToCheck = [
  './src/apps/crons/arangoScript.js',
  './models/mongodb.js',
  './models/db.js'
];

filesToCheck.forEach(checkFileForSecrets);

if (!foundHardcodedSecrets) {
  console.log('✅ No obvious hardcoded secrets detected');
}

// Security Summary
console.log('\n📊 Security Summary:');
console.log('===================');
console.log(`❌ Critical Issues: ${criticalIssues}`);
console.log(`⚠️  Warnings: ${warnings}`);

if (criticalIssues > 0) {
  console.log('\n🚨 PRODUCTION READINESS: BLOCKED');
  console.log('Critical security issues must be resolved before deployment.');
  process.exit(1);
} else if (warnings > 0) {
  console.log('\n⚠️  PRODUCTION READINESS: CAUTION');
  console.log('Consider addressing warnings before production deployment.');
  process.exit(0);
} else {
  console.log('\n✅ PRODUCTION READINESS: GOOD');
  console.log('Basic security checks passed. Consider additional security audits.');
  process.exit(0);
}