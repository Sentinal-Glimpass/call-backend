#!/usr/bin/env node

const axios = require('axios');

async function testWatiAPI() {
  try {
    console.log('🧪 Testing WATI API...');

    const recipient = '+919608848421';
    const templateId = '68cb0e7d74e6662ce8692f2b'; // This is actually a tool ID, not template ID
    const apiKey = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJkMjAzODg1My1kZWYyLTRhYTQtODFiZS01OTJlMGU5MzlmNTIiLCJ1bmlxdWVfbmFtZSI6IkZvdW5kZXJAZHZpdmlkY29uc3VsdGFudC5jb20iLCJuYW1laWQiOiJGb3VuZGVyQGR2aXZpZGNvbnN1bHRhbnQuY29tIiwiZW1haWwiOiJGb3VuZGVyQGR2aXZpZGNvbnN1bHRhbnQuY29tIiwiYXV0aF90aW1lIjoiMDgvMjAvMjAyNSAxNzoyMzowOSIsInRlbmFudF9pZCI6IjM4ODg3MSIsImRiX25hbWUiOiJtdC1wcm9kLVRlbmFudHMiLCJodHRwOi8vc2NoZW1hcy5taWNyb3NvZnQuY29tL3dzLzIwMDgvMDYvaWRlbnRpdHkvY2xhaW1zL3JvbGUiOiJBRE1JTklTVFJBVE9SIiwiZXhwIjoyNTM0MDIzMDA4MDAsImlzcyI6IkNsYXJlX0FJIiwiYXVkIjoiQ2xhcmVfQUkifQ.jvMHjhvNLD_Aafyg-4s3Exptqgm-8NgzKYL0U8nmoaY';

    // First, let's get the tool details from our API to get the actual template name
    console.log('📋 Fetching tool details from our API...');

    const toolResponse = await axios.get(`http://localhost:7999/api/tools/wati/bot/678782afa8d9072894be7ca9`, {
      headers: {
        'Authorization': 'Bearer test_super_key_for_tools_api_admin_access_2024'
      }
    });

    console.log('✅ Tool response:', JSON.stringify(toolResponse.data, null, 2));

    // Find the tool with the matching ID
    const tool = toolResponse.data.wati_tools?.find(t => t.wati_tool_id === templateId);

    if (!tool) {
      console.error('❌ Tool not found with ID:', templateId);
      return;
    }

    console.log('🔧 Found tool:', tool);

    // Format recipient (ensure it starts with country code, digits only for WATI)
    let formattedRecipient = recipient.replace(/\D/g, '');
    if (!formattedRecipient.startsWith('91') && formattedRecipient.length === 10) {
      formattedRecipient = '91' + formattedRecipient;
    }
    // WATI expects digits only, no + prefix

    console.log('📱 Formatted recipient:', formattedRecipient);

    // For now, let's try to get the template name from the tool
    // We need to figure out what template name to use

    // Let's try getting templates first to see what's available
    console.log('📋 Fetching available templates...');

    const baseUrl = 'https://live-mt-server.wati.io/388871/api/v1'; // Using tenant ID from JWT

    const templatesResponse = await axios.get(`${baseUrl}/getMessageTemplates`, {
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      }
    });

    console.log(`📋 Found ${templatesResponse.data.messageTemplates?.length} templates available`);

    // Find the specific template that matches our tool's template_id
    const targetTemplate = templatesResponse.data.messageTemplates?.find(t => t.id === tool.template_id);

    if (targetTemplate) {
      console.log('🎯 Found target template:', targetTemplate);
      if (targetTemplate.status !== 'APPROVED') {
        console.log('⚠️ Target template is not approved, status:', targetTemplate.status);
        console.log('🔄 Looking for approved version of the same template...');

        // Look for approved version with similar name
        const approvedVersion = templatesResponse.data.messageTemplates?.find(t =>
          t.status === 'APPROVED' && t.elementName.includes('20th_sept_canada_webinar')
        );

        if (approvedVersion) {
          console.log('✅ Found approved version:', approvedVersion.elementName);
          var testTemplate = approvedVersion;
        } else {
          console.log('❌ No approved version found, using first approved template');
          const approvedTemplates = templatesResponse.data.messageTemplates?.filter(t => t.status === 'APPROVED');
          var testTemplate = approvedTemplates[0];
        }
      } else {
        var testTemplate = targetTemplate;
      }
    } else {
      console.log('⚠️ Target template not found, using first approved template');
      const approvedTemplates = templatesResponse.data.messageTemplates?.filter(t => t.status === 'APPROVED');
      var testTemplate = approvedTemplates[0];
    }

    console.log('🎯 Using template for test:', {
      name: testTemplate.elementName,
      status: testTemplate.status,
      id: testTemplate.id
    });

    // Try different payload format - some WATI APIs use different field names
    const payload = {
      template_name: testTemplate.elementName,
      broadcast_name: `test_${Date.now()}`,
      receivers: [
        {
          whatsappNumber: formattedRecipient,
          customParams: []
        }
      ]
    };

    console.log('🔍 Trying alternative payload format...');
    const alternativePayload = {
      templateName: testTemplate.elementName,
      broadcastName: `test_alt_${Date.now()}`,
      receivers: [formattedRecipient]
    };

    console.log('📤 Trying first payload format:', JSON.stringify(payload, null, 2));

    // Try first format
    try {
      const response = await axios.post(`${baseUrl}/sendTemplateMessage`, payload, {
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ First format worked! Message sent successfully!');
      console.log('📨 Response:', JSON.stringify(response.data, null, 2));
      return;

    } catch (error) {
      console.log('❌ First format failed:', error.response?.data);
      console.log('🔄 Trying alternative format...');
    }

    console.log('📤 Trying alternative payload format:', JSON.stringify(alternativePayload, null, 2));

    // Try alternative format
    const response2 = await axios.post(`${baseUrl}/sendTemplateMessage`, alternativePayload, {
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Alternative format worked! Message sent successfully!');
    console.log('📨 Response:', JSON.stringify(response2.data, null, 2));

  } catch (error) {
    console.error('❌ Error testing WATI API:', error.response?.data || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
    }
  }
}

// Run the test
testWatiAPI();