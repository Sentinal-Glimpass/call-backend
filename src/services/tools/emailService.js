const { connectToMongo, client } = require('../../../models/mongodb.js');
const { ObjectId } = require('mongodb');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const TelephonyCredentialsService = require('../telephonyCredentialsService');
const gcsService = require('../gcsService');

/**
 * Email Tool Service
 *
 * Manages Email-specific tool configurations and operations:
 * - Email tool instances (emailTools collection)
 * - Agent assignments (agentEmailTools collection)
 * - SMTP configuration and sending
 * - Bot integration with encrypted credentials
 */

// =============================================================================
// EMAIL TOOL INSTANCES MANAGEMENT
// =============================================================================

/**
 * Get email tool instances for client
 */
async function getEmailTools(clientId, filters = {}) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const query = { client_id: clientId, ...filters };
    const tools = await db.collection('emailTools').find(query).toArray();

    return {
      success: true,
      status: 200,
      message: 'Email tools retrieved successfully',
      data: tools,
      count: tools.length
    };
  } catch (error) {
    console.error('Error fetching email tools:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching email tools',
      error: error.message
    };
  }
}

/**
 * Create new email tool instance
 */
async function createEmailTool(toolData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Check for duplicate tool name within client
    const existingTool = await db.collection('emailTools')
      .findOne({
        client_id: toolData.client_id,
        tool_name: toolData.tool_name
      });

    if (existingTool) {
      return {
        success: false,
        status: 400,
        message: `Email tool '${toolData.tool_name}' already exists for this client`
      };
    }

    // Validate required fields
    if (!toolData.tool_name || !toolData.email_type) {
      return {
        success: false,
        status: 400,
        message: 'tool_name and email_type are required'
      };
    }

    // Validate template reference if provided
    if (toolData.template_id) {
      const template = await db.collection('emailTemplates')
        .findOne({
          _id: new ObjectId(toolData.template_id),
          client_id: toolData.client_id
        });

      if (!template) {
        return {
          success: false,
          status: 400,
          message: 'Referenced email template not found'
        };
      }
    }

    const emailTool = {
      ...toolData,
      enabled: toolData.enabled !== undefined ? toolData.enabled : true,
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('emailTools').insertOne(emailTool);

    return {
      success: true,
      status: 201,
      message: 'Email tool created successfully',
      data: { _id: result.insertedId, ...emailTool }
    };
  } catch (error) {
    console.error('Error creating email tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error creating email tool',
      error: error.message
    };
  }
}

/**
 * Get specific email tool
 */
async function getEmailToolById(toolId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const tool = await db.collection('emailTools')
      .findOne({
        _id: new ObjectId(toolId),
        client_id: clientId
      });

    if (!tool) {
      return {
        success: false,
        status: 404,
        message: 'Email tool not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'Email tool retrieved successfully',
      data: tool
    };
  } catch (error) {
    console.error('Error fetching email tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching email tool',
      error: error.message
    };
  }
}

/**
 * Update email tool
 */
async function updateEmailTool(toolId, clientId, updateData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const updateDoc = {
      ...updateData,
      updated_at: new Date()
    };

    const result = await db.collection('emailTools')
      .findOneAndUpdate(
        { _id: new ObjectId(toolId), client_id: clientId },
        { $set: updateDoc },
        { returnDocument: 'after' }
      );

    if (!result) {
      return {
        success: false,
        status: 404,
        message: 'Email tool not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'Email tool updated successfully',
      data: result
    };
  } catch (error) {
    console.error('Error updating email tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error updating email tool',
      error: error.message
    };
  }
}

/**
 * Delete email tool
 */
async function deleteEmailTool(toolId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Check if tool is assigned to any agents
    const assignmentCount = await db.collection('agentEmailTools')
      .countDocuments({
        'assigned_tools.email_tool_id': new ObjectId(toolId)
      });

    if (assignmentCount > 0) {
      return {
        success: false,
        status: 400,
        message: `Cannot delete email tool. It is assigned to ${assignmentCount} agents.`
      };
    }

    const result = await db.collection('emailTools')
      .deleteOne({
        _id: new ObjectId(toolId),
        client_id: clientId
      });

    if (result.deletedCount === 0) {
      return {
        success: false,
        status: 404,
        message: 'Email tool not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'Email tool deleted successfully'
    };
  } catch (error) {
    console.error('Error deleting email tool:', error);
    return {
      success: false,
      status: 500,
      message: 'Error deleting email tool',
      error: error.message
    };
  }
}

// =============================================================================
// EMAIL TEMPLATES AND VALIDATION
// =============================================================================

/**
 * Get email template types
 */
function getEmailTemplateTypes() {
  return [
    {
      type: 'welcome',
      name: 'Welcome Email',
      description: 'Welcome new users or customers',
      variables: ['user_name', 'company_name', 'login_url']
    },
    {
      type: 'notification',
      name: 'Notification Email',
      description: 'System notifications and alerts',
      variables: ['user_name', 'notification_title', 'notification_message', 'action_url']
    },
    {
      type: 'followup',
      name: 'Follow-up Email',
      description: 'Follow up on leads or inquiries',
      variables: ['contact_name', 'company_name', 'follow_up_message', 'contact_url']
    },
    {
      type: 'reminder',
      name: 'Reminder Email',
      description: 'Reminders for appointments or tasks',
      variables: ['user_name', 'reminder_title', 'reminder_date', 'reminder_details']
    },
    {
      type: 'support',
      name: 'Support Email',
      description: 'Customer support responses',
      variables: ['customer_name', 'ticket_id', 'support_message', 'support_agent']
    },
    {
      type: 'custom',
      name: 'Custom Email',
      description: 'Custom email with user-defined variables',
      variables: []
    }
  ];
}

/**
 * Validate email tool parameters
 */
function validateEmailParameters(parameters) {
  const errors = [];

  if (!parameters.subject) {
    errors.push('Email subject is required');
  }

  if (!parameters.body && !parameters.template) {
    errors.push('Email body or template is required');
  }

  if (parameters.to && typeof parameters.to !== 'string') {
    errors.push('Recipient email must be a string');
  }

  return errors;
}

/**
 * Test email configuration
 */
async function testEmailConfiguration(clientId, testData = {}) {
  try {
    const credentials = await TelephonyCredentialsService.getClientCredentials(clientId);

    if (!credentials.gmail) {
      return {
        success: false,
        message: 'Gmail credentials not found'
      };
    }

    const { gmail_user, gmail_password } = credentials.gmail;

    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmail_user,
        pass: gmail_password
      }
    });

    // Test connection
    await transporter.verify();

    // Send test email if requested
    if (testData.send_test && testData.test_email) {
      const mailOptions = {
        from: gmail_user,
        to: testData.test_email,
        subject: 'Test Email Configuration',
        text: 'This is a test email to verify your email configuration is working properly.',
        html: '<h3>Email Configuration Test</h3><p>This is a test email to verify your email configuration is working properly.</p>'
      };

      const info = await transporter.sendMail(mailOptions);

      return {
        success: true,
        message: 'Email configuration test successful',
        test_email_sent: true,
        message_id: info.messageId
      };
    }

    return {
      success: true,
      message: 'Email configuration verified successfully',
      smtp_verified: true
    };

  } catch (error) {
    return {
      success: false,
      message: 'Email configuration test failed',
      error: error.message
    };
  }
}

// =============================================================================
// AGENT ASSIGNMENTS
// =============================================================================

/**
 * Get agent's email tool assignments
 */
async function getAgentEmailTools(agentId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const assignment = await db.collection('agentEmailTools')
      .findOne({ agent_id: agentId });

    if (!assignment) {
      return {
        success: true,
        status: 200,
        message: 'No email tools assigned to agent',
        data: {
          agent_id: agentId,
          assigned_tools: []
        }
      };
    }

    // Enrich with tool details
    const enrichedTools = await Promise.all(
      assignment.assigned_tools.map(async (assignedTool) => {
        const tool = await db.collection('emailTools')
          .findOne({ _id: assignedTool.email_tool_id });

        return {
          ...assignedTool,
          tool_details: tool
        };
      })
    );

    return {
      success: true,
      status: 200,
      message: 'Agent email tools retrieved successfully',
      data: {
        ...assignment,
        assigned_tools: enrichedTools
      }
    };
  } catch (error) {
    console.error('Error fetching agent email tools:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching agent email tools',
      error: error.message
    };
  }
}

/**
 * Assign email tool to agent
 */
async function assignEmailToolToAgent(agentId, clientId, assignmentData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Support both field names for backward compatibility
    const toolId = assignmentData.email_tool_id || assignmentData.tool_id;

    if (!toolId) {
      return {
        success: false,
        status: 400,
        message: 'email_tool_id or tool_id is required'
      };
    }

    // Validate tool exists and belongs to client
    const tool = await db.collection('emailTools')
      .findOne({
        _id: new ObjectId(toolId),
        client_id: clientId
      });

    if (!tool) {
      return {
        success: false,
        status: 404,
        message: 'Email tool not found or does not belong to client'
      };
    }

    const assignment = {
      email_tool_id: new ObjectId(toolId),
      enabled: assignmentData.enabled !== undefined ? assignmentData.enabled : true,
      conditions_override: assignmentData.conditions_override || null,
      parameters_override: assignmentData.parameters_override || {}
    };

    // Check if already assigned
    const existingAssignment = await db.collection('agentEmailTools')
      .findOne({
        agent_id: agentId,
        'assigned_tools.email_tool_id': assignment.email_tool_id
      });

    if (existingAssignment) {
      return {
        success: false,
        status: 400,
        message: 'Email tool already assigned to agent'
      };
    }

    // Add to existing assignment or create new
    const result = await db.collection('agentEmailTools')
      .findOneAndUpdate(
        { agent_id: agentId },
        {
          $push: { assigned_tools: assignment },
          $setOnInsert: {
            agent_id: agentId,
            client_id: clientId,
            created_at: new Date()
          },
          $set: { updated_at: new Date() }
        },
        {
          upsert: true,
          returnDocument: 'after'
        }
      );

    return {
      success: true,
      status: 200,
      message: 'Email tool assigned to agent successfully',
      data: result
    };
  } catch (error) {
    console.error('Error assigning email tool to agent:', error);
    return {
      success: false,
      status: 500,
      message: 'Error assigning email tool to agent',
      error: error.message
    };
  }
}

/**
 * Remove email tool from agent
 */
async function removeEmailToolFromAgent(agentId, toolId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const result = await db.collection('agentEmailTools')
      .findOneAndUpdate(
        { agent_id: agentId },
        {
          $pull: {
            assigned_tools: {
              email_tool_id: new ObjectId(toolId)
            }
          },
          $set: { updated_at: new Date() }
        },
        { returnDocument: 'after' }
      );

    if (!result) {
      return {
        success: false,
        status: 404,
        message: 'Agent assignment not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'Email tool removed from agent successfully'
    };
  } catch (error) {
    console.error('Error removing email tool from agent:', error);
    return {
      success: false,
      status: 500,
      message: 'Error removing email tool from agent',
      error: error.message
    };
  }
}

/**
 * Toggle email tool for agent
 */
async function toggleEmailToolForAgent(agentId, toolId, enabled) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const result = await db.collection('agentEmailTools')
      .findOneAndUpdate(
        {
          agent_id: agentId,
          'assigned_tools.email_tool_id': new ObjectId(toolId)
        },
        {
          $set: {
            'assigned_tools.$.enabled': enabled,
            updated_at: new Date()
          }
        },
        { returnDocument: 'after' }
      );

    if (!result) {
      return {
        success: false,
        status: 404,
        message: 'Email tool assignment not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: `Email tool ${enabled ? 'enabled' : 'disabled'} for agent successfully`
    };
  } catch (error) {
    console.error('Error toggling email tool for agent:', error);
    return {
      success: false,
      status: 500,
      message: 'Error toggling email tool for agent',
      error: error.message
    };
  }
}

// =============================================================================
// EMAIL TEMPLATES MANAGEMENT
// =============================================================================

/**
 * Get email templates for client
 */
async function getEmailTemplates(clientId, filters = {}) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const query = { client_id: clientId, ...filters };
    const templates = await db.collection('emailTemplates').find(query).toArray();

    return {
      success: true,
      status: 200,
      message: 'Email templates retrieved successfully',
      data: templates,
      count: templates.length
    };
  } catch (error) {
    console.error('Error fetching email templates:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching email templates',
      error: error.message
    };
  }
}

/**
 * Create new email template
 */
async function createEmailTemplate(clientId, templateData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Check for duplicate template name within client
    const existingTemplate = await db.collection('emailTemplates')
      .findOne({
        client_id: clientId,
        template_name: templateData.template_name
      });

    if (existingTemplate) {
      return {
        success: false,
        status: 400,
        message: `Email template '${templateData.template_name}' already exists for this client`
      };
    }

    // Validate required fields
    if (!templateData.template_name || !templateData.template_type) {
      return {
        success: false,
        status: 400,
        message: 'template_name and template_type are required'
      };
    }

    const emailTemplate = {
      client_id: clientId,
      template_name: templateData.template_name,
      template_type: templateData.template_type || 'custom',
      subject: templateData.subject || '',
      body_html: templateData.body_html || templateData.html_content || '',
      body_text: templateData.body_text || templateData.text_content || '',
      variables: templateData.variables || [],
      attachments: [], // Will be populated via separate upload endpoint
      description: templateData.description || '',
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('emailTemplates').insertOne(emailTemplate);

    return {
      success: true,
      status: 201,
      message: 'Email template created successfully',
      data: { _id: result.insertedId, ...emailTemplate }
    };
  } catch (error) {
    console.error('Error creating email template:', error);
    return {
      success: false,
      status: 500,
      message: 'Error creating email template',
      error: error.message
    };
  }
}

/**
 * Get specific email template
 */
async function getEmailTemplateById(templateId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const template = await db.collection('emailTemplates')
      .findOne({
        _id: new ObjectId(templateId),
        client_id: clientId
      });

    if (!template) {
      return {
        success: false,
        status: 404,
        message: 'Email template not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'Email template retrieved successfully',
      data: template
    };
  } catch (error) {
    console.error('Error fetching email template:', error);
    return {
      success: false,
      status: 500,
      message: 'Error fetching email template',
      error: error.message
    };
  }
}

/**
 * Update email template
 */
async function updateEmailTemplate(templateId, clientId, updateData) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    const updateDoc = {
      ...updateData,
      updated_at: new Date()
    };

    const result = await db.collection('emailTemplates')
      .findOneAndUpdate(
        { _id: new ObjectId(templateId), client_id: clientId },
        { $set: updateDoc },
        { returnDocument: 'after' }
      );

    if (!result) {
      return {
        success: false,
        status: 404,
        message: 'Email template not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'Email template updated successfully',
      data: result
    };
  } catch (error) {
    console.error('Error updating email template:', error);
    return {
      success: false,
      status: 500,
      message: 'Error updating email template',
      error: error.message
    };
  }
}

/**
 * Delete email template
 */
async function deleteEmailTemplate(templateId, clientId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Get template to check for attachments
    const template = await db.collection('emailTemplates')
      .findOne({
        _id: new ObjectId(templateId),
        client_id: clientId
      });

    if (!template) {
      return {
        success: false,
        status: 404,
        message: 'Email template not found'
      };
    }

    // Check if template is being used by any email tools
    const usageCount = await db.collection('emailTools')
      .countDocuments({
        template_id: templateId,
        client_id: clientId
      });

    if (usageCount > 0) {
      return {
        success: false,
        status: 400,
        message: `Cannot delete template. It is being used by ${usageCount} email tools.`
      };
    }

    // Delete attachments from GCS
    if (template.attachments && template.attachments.length > 0) {
      for (const attachment of template.attachments) {
        try {
          await gcsService.deleteFile(attachment.gcs_path);
        } catch (error) {
          console.error('Error deleting attachment from GCS:', error);
          // Continue with template deletion even if file deletion fails
        }
      }
    }

    // Delete template
    const result = await db.collection('emailTemplates')
      .deleteOne({
        _id: new ObjectId(templateId),
        client_id: clientId
      });

    if (result.deletedCount === 0) {
      return {
        success: false,
        status: 404,
        message: 'Email template not found'
      };
    }

    return {
      success: true,
      status: 200,
      message: 'Email template deleted successfully'
    };
  } catch (error) {
    console.error('Error deleting email template:', error);
    return {
      success: false,
      status: 500,
      message: 'Error deleting email template',
      error: error.message
    };
  }
}

/**
 * Add attachment to email template
 */
async function addTemplateAttachment(templateId, clientId, file) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Verify template exists
    const template = await db.collection('emailTemplates')
      .findOne({
        _id: new ObjectId(templateId),
        client_id: clientId
      });

    if (!template) {
      return {
        success: false,
        status: 404,
        message: 'Email template not found'
      };
    }

    // Upload file to GCS
    const uploadResult = await gcsService.uploadFile(file, clientId, templateId);

    if (!uploadResult.success) {
      return uploadResult;
    }

    // Add attachment to template
    const attachment = {
      _id: new ObjectId(),
      filename: uploadResult.data.originalname,
      gcs_url: uploadResult.data.gcs_url,
      gcs_path: uploadResult.data.gcs_path,
      content_type: uploadResult.data.mimetype,
      size: uploadResult.data.size,
      uploaded_at: new Date()
    };

    const result = await db.collection('emailTemplates')
      .findOneAndUpdate(
        { _id: new ObjectId(templateId), client_id: clientId },
        {
          $push: { attachments: attachment },
          $set: { updated_at: new Date() }
        },
        { returnDocument: 'after' }
      );

    return {
      success: true,
      status: 200,
      message: 'Attachment added to template successfully',
      data: {
        template: result,
        attachment: attachment
      }
    };
  } catch (error) {
    console.error('Error adding template attachment:', error);
    return {
      success: false,
      status: 500,
      message: 'Error adding template attachment',
      error: error.message
    };
  }
}

/**
 * Remove attachment from email template
 */
async function removeTemplateAttachment(templateId, clientId, attachmentId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Get template and find attachment
    const template = await db.collection('emailTemplates')
      .findOne({
        _id: new ObjectId(templateId),
        client_id: clientId
      });

    if (!template) {
      return {
        success: false,
        status: 404,
        message: 'Email template not found'
      };
    }

    const attachment = template.attachments.find(
      att => att._id.toString() === attachmentId
    );

    if (!attachment) {
      return {
        success: false,
        status: 404,
        message: 'Attachment not found'
      };
    }

    // Delete file from GCS
    await gcsService.deleteFile(attachment.gcs_path);

    // Remove attachment from template
    const result = await db.collection('emailTemplates')
      .findOneAndUpdate(
        { _id: new ObjectId(templateId), client_id: clientId },
        {
          $pull: { attachments: { _id: new ObjectId(attachmentId) } },
          $set: { updated_at: new Date() }
        },
        { returnDocument: 'after' }
      );

    return {
      success: true,
      status: 200,
      message: 'Attachment removed from template successfully',
      data: result
    };
  } catch (error) {
    console.error('Error removing template attachment:', error);
    return {
      success: false,
      status: 500,
      message: 'Error removing template attachment',
      error: error.message
    };
  }
}

// =============================================================================
// BOT INTEGRATION
// =============================================================================

/**
 * Encrypt credentials for bot transmission
 */
async function encryptCredentials(credentials, masterKey) {
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher(algorithm, masterKey);

  let encrypted = cipher.update(JSON.stringify(credentials), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Get complete email configuration for bot
 */
async function getEmailConfigForBot(agentId) {
  try {
    await connectToMongo();
    const db = client.db('glimpass');

    // Get agent assignments
    const assignment = await db.collection('agentEmailTools')
      .findOne({ agent_id: agentId });

    if (!assignment) {
      return {
        success: false,
        status: 404,
        message: 'No email tools assigned to agent'
      };
    }

    // Get enabled tools
    const enabledTools = assignment.assigned_tools.filter(tool => tool.enabled);
    const toolIds = enabledTools.map(t => t.email_tool_id);

    const tools = await db.collection('emailTools')
      .find({ _id: { $in: toolIds } }).toArray();

    // Get credentials for client
    const credentials = await TelephonyCredentialsService.getClientCredentials(assignment.client_id);

    if (!credentials.gmail) {
      return {
        success: false,
        status: 404,
        message: 'Gmail credentials not found for client'
      };
    }

    // Build complete tool configurations
    const emailTools = await Promise.all(
      enabledTools.map(async (assignedTool) => {
        const tool = tools.find(t =>
          t._id.toString() === assignedTool.email_tool_id.toString()
        );

        if (!tool) return null;

        let finalParameters = {
          subject: tool.subject,
          body: tool.body,
          email_type: tool.email_type,
          variables: tool.variables || [],
          attachments: [],
          ...assignedTool.parameters_override
        };

        // If tool references a template, get template data
        if (tool.template_id) {
          const template = await db.collection('emailTemplates')
            .findOne({ _id: new ObjectId(tool.template_id) });

          if (template) {
            // Template overrides tool's subject/body
            finalParameters = {
              ...finalParameters,
              subject: template.subject || finalParameters.subject,
              body_html: template.body_html || '',
              body_text: template.body_text || finalParameters.body,
              variables: [...(template.variables || []), ...(finalParameters.variables || [])],
              attachments: template.attachments || [],
              template_id: tool.template_id,
              template_name: template.template_name
            };
          }
        }

        // Merge conditions (assignment overrides tool)
        const finalConditions = assignedTool.conditions_override || tool.conditions;

        // Encrypt credentials
        const encryptedCreds = await encryptCredentials(
          credentials.gmail,
          process.env.MASTER_KEY
        );

        // Create standard Claude MCP config for internal Gmail server
        return {
          name: `gmail-${tool._id.toString()}`,
          transport: {
            type: 'http',
            path: `/mcp/gmail/${agentId}`,
            headers: {
              'Authorization': `Bearer ${process.env.SUPER_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        };
      })
    );

    // Filter out null values and return standard MCP configurations
    const mcpConfigurations = emailTools.filter(config => config !== null);

    return {
      success: true,
      status: 200,
      mcp_configurations: mcpConfigurations
    };

  } catch (error) {
    console.error('Error getting email config for bot:', error);
    return {
      success: false,
      status: 500,
      message: 'Error retrieving email configuration',
      error: error.message
    };
  }
}

/**
 * Alias for getEmailConfigForBot - returns MCP configurations in standard format
 */
async function getEmailMcpConfigurations(agentId) {
  return await getEmailConfigForBot(agentId);
}

module.exports = {
  // Tool Management
  getEmailTools,
  createEmailTool,
  getEmailToolById,
  updateEmailTool,
  deleteEmailTool,

  // Templates & Validation
  getEmailTemplateTypes,
  validateEmailParameters,
  testEmailConfiguration,

  // Email Templates Management
  getEmailTemplates,
  createEmailTemplate,
  getEmailTemplateById,
  updateEmailTemplate,
  deleteEmailTemplate,
  addTemplateAttachment,
  removeTemplateAttachment,

  // Agent Assignments
  getAgentEmailTools,
  assignEmailToolToAgent,
  removeEmailToolFromAgent,
  toggleEmailToolForAgent,

  // Bot Integration
  getEmailConfigForBot,
  getEmailMcpConfigurations
};