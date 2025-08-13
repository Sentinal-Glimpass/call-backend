#!/usr/bin/env node

/**
 * Test Runner Script
 * Executes comprehensive testing suite and generates reports
 */

const TestFramework = require('./testFramework.js');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('🚀 Enhanced Telephony System - Integration & Testing Suite');
  console.log('===========================================================');
  
  const testFramework = new TestFramework();
  
  try {
    // Run all tests
    const results = await testFramework.runAllTests();
    
    // Generate detailed report file
    await generateDetailedReport(results);
    
    // Print summary
    console.log('\n📋 FINAL TEST SUMMARY');
    console.log('====================');
    console.log(`Total Tests: ${results.summary.total}`);
    console.log(`Passed: ${results.summary.passed} ✅`);
    console.log(`Failed: ${results.summary.failed} ❌`);
    console.log(`Success Rate: ${results.summary.coverage}%`);
    
    // Determine exit code
    const exitCode = results.summary.failed > 0 ? 1 : 0;
    
    if (exitCode === 0) {
      console.log('\n🎉 ALL TESTS PASSED! System is ready for production deployment.');
    } else {
      console.log('\n⚠️  Some tests failed. Please review the detailed report and fix issues before deployment.');
    }
    
    // Exit with appropriate code
    process.exit(exitCode);
    
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

/**
 * Generate detailed HTML test report
 */
async function generateDetailedReport(results) {
  try {
    const reportDir = path.join(__dirname, '../../reports');
    
    // Ensure reports directory exists
    try {
      await fs.access(reportDir);
    } catch {
      await fs.mkdir(reportDir, { recursive: true });
    }
    
    const reportPath = path.join(reportDir, `test-report-${Date.now()}.html`);
    
    const htmlReport = generateHTMLReport(results);
    await fs.writeFile(reportPath, htmlReport);
    
    console.log(`\n📊 Detailed test report saved to: ${reportPath}`);
    
    // Also save JSON report
    const jsonReportPath = path.join(reportDir, `test-results-${Date.now()}.json`);
    await fs.writeFile(jsonReportPath, JSON.stringify(results, null, 2));
    
    console.log(`📊 JSON test results saved to: ${jsonReportPath}`);
    
  } catch (error) {
    console.error('❌ Error generating test report:', error);
  }
}

/**
 * Generate HTML report
 */
function generateHTMLReport(results) {
  const timestamp = new Date().toISOString();
  
  const unitTestsHTML = generateTestSectionHTML('Unit Tests', results.unit);
  const integrationTestsHTML = generateTestSectionHTML('Integration Tests', results.integration);
  const loadTestsHTML = generateTestSectionHTML('Load Tests', results.load);
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Enhanced Telephony System - Test Report</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 3px solid #007bff;
        }
        .header h1 {
            color: #333;
            margin-bottom: 10px;
        }
        .timestamp {
            color: #666;
            font-size: 14px;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        .summary-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .summary-card.passed {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
        }
        .summary-card.failed {
            background: linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%);
        }
        .summary-card.coverage {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            font-size: 2em;
        }
        .summary-card p {
            margin: 0;
            opacity: 0.9;
        }
        .test-section {
            margin-bottom: 40px;
        }
        .test-section h2 {
            color: #333;
            border-bottom: 2px solid #eee;
            padding-bottom: 10px;
        }
        .test-grid {
            display: grid;
            gap: 15px;
        }
        .test-item {
            background: white;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 15px;
            border-left: 4px solid #28a745;
        }
        .test-item.failed {
            border-left-color: #dc3545;
            background-color: #fff5f5;
        }
        .test-name {
            font-weight: bold;
            color: #333;
            margin-bottom: 8px;
        }
        .test-details {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.9em;
            color: #666;
        }
        .test-duration {
            background: #f8f9fa;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8em;
        }
        .test-status {
            font-weight: bold;
        }
        .test-status.passed {
            color: #28a745;
        }
        .test-status.failed {
            color: #dc3545;
        }
        .error-message {
            margin-top: 10px;
            padding: 10px;
            background-color: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
            color: #721c24;
            font-family: monospace;
            font-size: 0.9em;
        }
        .footer {
            margin-top: 50px;
            text-align: center;
            padding-top: 20px;
            border-top: 1px solid #eee;
            color: #666;
            font-size: 0.9em;
        }
        @media (max-width: 768px) {
            .container {
                padding: 15px;
            }
            .summary {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 Enhanced Telephony System Test Report</h1>
            <div class="timestamp">Generated on ${timestamp}</div>
        </div>
        
        <div class="summary">
            <div class="summary-card">
                <h3>${results.summary.total}</h3>
                <p>Total Tests</p>
            </div>
            <div class="summary-card passed">
                <h3>${results.summary.passed}</h3>
                <p>Passed</p>
            </div>
            <div class="summary-card failed">
                <h3>${results.summary.failed}</h3>
                <p>Failed</p>
            </div>
            <div class="summary-card coverage">
                <h3>${results.summary.coverage}%</h3>
                <p>Success Rate</p>
            </div>
        </div>
        
        ${unitTestsHTML}
        ${integrationTestsHTML}
        ${loadTestsHTML}
        
        <div class="footer">
            <p>Enhanced Telephony System - Integration & Testing Framework</p>
            <p>Generated by Claude Code Integration & Testing Agent</p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generate HTML for a test section
 */
function generateTestSectionHTML(sectionName, tests) {
  const testItemsHTML = tests.map(test => {
    const statusClass = test.passed ? 'passed' : 'failed';
    const statusText = test.passed ? '✅ PASSED' : '❌ FAILED';
    const errorHTML = !test.passed && test.error ? 
      `<div class="error-message">${escapeHtml(test.error)}</div>` : '';
    
    return `
      <div class="test-item ${test.passed ? '' : 'failed'}">
          <div class="test-name">${escapeHtml(test.name)}</div>
          <div class="test-details">
              <span class="test-status ${statusClass}">${statusText}</span>
              <span class="test-duration">${test.duration}ms</span>
          </div>
          ${errorHTML}
      </div>
    `;
  }).join('');
  
  return `
    <div class="test-section">
        <h2>${sectionName} (${tests.length} tests)</h2>
        <div class="test-grid">
            ${testItemsHTML}
        </div>
    </div>
  `;
}

/**
 * Escape HTML characters
 */
function escapeHtml(text) {
  const div = { innerHTML: '' };
  div.textContent = text;
  return div.innerHTML || text.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { runTests };