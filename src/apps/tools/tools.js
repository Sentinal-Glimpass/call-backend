const { connectToMongo, closeMongoConnection, client } = require('../../../models/mongodb.js');
const { ObjectId } = require('mongodb');
const axios = require('axios');

// Import telephony credentials service for WATI integration
const TelephonyCredentialsService = require('../../services/telephonyCredentialsService');

// =============================================================================
// MONGODB SCHEMAS & COLLECTIONS
// =============================================================================

/**
 * MongoDB Collections:
 * 
 * 1. toolsRegistry - System-level tool definitions
 * {
 *   _id: ObjectId,
 *   name: "whatsapp", // Unique tool identifier
 *   description: "WhatsApp messaging integration",
 *   version: "1.0.0",
 *   openai_schema: {
 *     type: "function",
 *     function: {
 *       name: "send_whatsapp_message",
 *       description: "Send a WhatsApp message",
 *       parameters: {
 *         type: "object",
 *         properties: {
 *           phone: { type: "string", description: "Phone number" },
 *           message: { type: "string", description: "Message content" }
 *         },
 *         required: ["phone", "message"]
 *       }
 *     }
 *   },
 *   endpoint_config: {
 *     method: "POST",
 *     base_url: "https://api.whatsapp.com/v1",
 *     path: "/messages",
 *     headers: { "Content-Type": "application/json" },
 *     auth_type: "bearer" // bearer, api_key, basic, custom
 *   },
 *   auth_requirements: ["api_token", "phone_number_id"],
 *   rate_limits: {
 *     default: { requests: 1000, period: "hour" },
 *     premium: { requests: 10000, period: "hour" }
 *   },
 *   created_at: Date,
 *   updated_at: Date,
 *   created_by: "system", // or admin user id
 *   active: true
 * }
 * 
 * 2. clientToolConfigs - Client-specific tool configurations
 * {
 *   _id: ObjectId,
 *   client_id: "client_123",
 *   config_name: "whatsapp_urgent", // User-friendly name
 *   tool_name: "whatsapp", // References toolsRegistry.name
 *   enabled: true,
 *   strategy: "conditional", // immediate, conditional, scheduled, manual
 *   parameters: {
 *     template_id: "welcome_template",
 *     default_message: "Hello from our service!"
 *   },
 *   credentials: {
 *     api_token: "encrypted_token",
 *     phone_number_id: "1234567890"
 *   },
 *   conditions: ["sms_failed", "high_priority"], // For conditional strategy
 *   schedule_config: { // For scheduled strategy
 *     delay_minutes: 30,
 *     retry_attempts: 3
 *   },
 *   rate_limits: {
 *     requests: 500,
 *     period: "hour"
 *   },
 *   assigned_campaigns: [], // Campaign IDs that can use this config
 *   created_at: Date,
 *   updated_at: Date,
 *   active: true
 * }
 * 
 * 3. toolExecutionLogs - Execution tracking and analytics
 * {
 *   _id: ObjectId,
 *   client_id: "client_123",
 *   config_id: ObjectId,
 *   tool_name: "whatsapp",
 *   function_name: "send_whatsapp_message",
 *   execution_context: {
 *     campaign_id: "camp_001",
 *     call_id: "call_456",
 *     trigger: "sms_failed"
 *   },
 *   request_data: { phone: "+1234567890", message: "Hello" },
 *   response_data: { message_id: "msg_789", status: "sent" },
 *   status: "success", // success, failed, pending
 *   error_message: null,
 *   execution_time_ms: 250,
 *   executed_at: Date
 * }
 */

// =============================================================================
// TOOLS REGISTRY MANAGEMENT (System-level)
// =============================================================================

async function createToolRegistry(toolData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("toolsRegistry");

    // Validate required fields
    const requiredFields = ['name', 'openai_schema', 'endpoint_config'];
    for (const field of requiredFields) {
      if (!toolData[field]) {
        return {
          status: 400,
          message: `Missing required field: ${field}`
        };
      }
    }

    // Check if tool already exists
    const existingTool = await collection.findOne({ name: toolData.name });
    if (existingTool) {
      return {
        status: 400,
        message: `Tool with name "${toolData.name}" already exists`
      };
    }

    // Create tool registry entry
    const toolRegistry = {
      ...toolData,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: "system",
      active: true
    };

    const result = await collection.insertOne(toolRegistry);

    return {
      status: 201,
      message: "Tool registry created successfully",
      tool_id: result.insertedId,
      tool_name: toolData.name
    };

  } catch (error) {
    console.error("Error creating tool registry:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

async function getToolsRegistry(filters = {}) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("toolsRegistry");

    const query = { active: true, ...filters };
    const tools = await collection.find(query).toArray();

    return {
      status: 200,
      message: "Tools registry retrieved successfully",
      tools: tools,
      count: tools.length
    };

  } catch (error) {
    console.error("Error fetching tools registry:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

async function getToolRegistryById(toolName) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("toolsRegistry");

    const tool = await collection.findOne({ name: toolName, active: true });

    if (!tool) {
      return {
        status: 404,
        message: `Tool "${toolName}" not found`
      };
    }

    return {
      status: 200,
      message: "Tool retrieved successfully",
      tool: tool
    };

  } catch (error) {
    console.error("Error fetching tool registry:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

async function updateToolRegistry(toolName, updateData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("toolsRegistry");

    const updateDoc = {
      ...updateData,
      updated_at: new Date()
    };

    const result = await collection.updateOne(
      { name: toolName, active: true },
      { $set: updateDoc }
    );

    if (result.matchedCount === 0) {
      return {
        status: 404,
        message: `Tool "${toolName}" not found`
      };
    }

    return {
      status: 200,
      message: "Tool registry updated successfully"
    };

  } catch (error) {
    console.error("Error updating tool registry:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

async function deleteToolRegistry(toolName) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("toolsRegistry");

    // Soft delete by setting active to false
    const result = await collection.updateOne(
      { name: toolName, active: true },
      { 
        $set: { 
          active: false, 
          updated_at: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return {
        status: 404,
        message: `Tool "${toolName}" not found`
      };
    }

    return {
      status: 200,
      message: "Tool registry deleted successfully"
    };

  } catch (error) {
    console.error("Error deleting tool registry:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

// =============================================================================
// CLIENT TOOL CONFIGURATIONS (Client-level)
// =============================================================================

async function createClientToolConfig(configData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const configCollection = database.collection("clientToolConfigs");
    const registryCollection = database.collection("toolsRegistry");

    // Validate required fields
    const requiredFields = ['client_id', 'config_name', 'tool_name', 'enabled'];
    for (const field of requiredFields) {
      if (configData[field] === undefined) {
        return {
          status: 400,
          message: `Missing required field: ${field}`
        };
      }
    }

    // Verify tool exists in registry
    const toolExists = await registryCollection.findOne({ 
      name: configData.tool_name, 
      active: true 
    });

    if (!toolExists) {
      return {
        status: 400,
        message: `Tool "${configData.tool_name}" not found in registry`
      };
    }

    // Check if config name already exists for this client
    const existingConfig = await configCollection.findOne({
      client_id: configData.client_id,
      config_name: configData.config_name,
      active: true
    });

    if (existingConfig) {
      return {
        status: 400,
        message: `Configuration "${configData.config_name}" already exists for this client`
      };
    }

    // Create configuration
    const toolConfig = {
      ...configData,
      assigned_campaigns: configData.assigned_campaigns || [],
      created_at: new Date(),
      updated_at: new Date(),
      active: true
    };

    const result = await configCollection.insertOne(toolConfig);

    return {
      status: 201,
      message: "Tool configuration created successfully",
      config_id: result.insertedId
    };

  } catch (error) {
    console.error("Error creating tool configuration:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

async function getClientToolConfigs(filters = {}) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("clientToolConfigs");

    const query = { active: true, ...filters };
    
    // Convert string booleans to actual booleans for enabled filter
    if (query.enabled !== undefined) {
      query.enabled = query.enabled === 'true' || query.enabled === true;
    }

    const configs = await collection.find(query).toArray();

    return {
      status: 200,
      message: "Tool configurations retrieved successfully",
      configs: configs,
      count: configs.length
    };

  } catch (error) {
    console.error("Error fetching tool configurations:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

async function getClientToolConfigById(configId, clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("clientToolConfigs");

    const config = await collection.findOne({
      _id: new ObjectId(configId),
      client_id: clientId,
      active: true
    });

    if (!config) {
      return {
        status: 404,
        message: "Tool configuration not found"
      };
    }

    return {
      status: 200,
      message: "Tool configuration retrieved successfully",
      config: config
    };

  } catch (error) {
    console.error("Error fetching tool configuration:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

async function updateClientToolConfig(configId, clientId, updateData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("clientToolConfigs");

    const updateDoc = {
      ...updateData,
      updated_at: new Date()
    };

    const result = await collection.updateOne(
      { 
        _id: new ObjectId(configId), 
        client_id: clientId,
        active: true 
      },
      { $set: updateDoc }
    );

    if (result.matchedCount === 0) {
      return {
        status: 404,
        message: "Tool configuration not found"
      };
    }

    return {
      status: 200,
      message: "Tool configuration updated successfully"
    };

  } catch (error) {
    console.error("Error updating tool configuration:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

async function deleteClientToolConfig(configId, clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("clientToolConfigs");

    // Soft delete by setting active to false
    const result = await collection.updateOne(
      { 
        _id: new ObjectId(configId), 
        client_id: clientId,
        active: true 
      },
      { 
        $set: { 
          active: false, 
          updated_at: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return {
        status: 404,
        message: "Tool configuration not found"
      };
    }

    return {
      status: 200,
      message: "Tool configuration deleted successfully"
    };

  } catch (error) {
    console.error("Error deleting tool configuration:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

// =============================================================================
// TOOL ORCHESTRATION (Runtime)
// =============================================================================

async function getToolsSchemas(clientId, context = {}) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const configCollection = database.collection("clientToolConfigs");
    const registryCollection = database.collection("toolsRegistry");

    // Build query filters
    let configQuery = {
      client_id: clientId,
      enabled: true,
      active: true
    };

    // Filter by campaign if provided
    if (context.campaign_id) {
      configQuery.$or = [
        { assigned_campaigns: { $in: [context.campaign_id] } },
        { assigned_campaigns: { $size: 0 } } // Configs with no campaign restrictions
      ];
    }

    // Get client's enabled tool configurations
    const configs = await configCollection.find(configQuery).toArray();

    if (configs.length === 0) {
      return {
        status: 200,
        message: "No enabled tool configurations found",
        schemas: []
      };
    }

    // Get tool registry entries for these configurations
    const toolNames = [...new Set(configs.map(config => config.tool_name))];
    const registryTools = await registryCollection.find({
      name: { $in: toolNames },
      active: true
    }).toArray();

    // Create a map of tool schemas
    const toolSchemaMap = {};
    registryTools.forEach(tool => {
      toolSchemaMap[tool.name] = tool.openai_schema;
    });

    // Build OpenAI function schemas
    const schemas = configs
      .filter(config => toolSchemaMap[config.tool_name])
      .map(config => {
        const baseSchema = toolSchemaMap[config.tool_name];
        return {
          ...baseSchema,
          function: {
            ...baseSchema.function,
            name: `${config.tool_name}_${config.config_name}`, // Unique function name
            description: `${baseSchema.function.description} (Config: ${config.config_name})`
          },
          config_id: config._id.toString(),
          tool_name: config.tool_name,
          strategy: config.strategy
        };
      });

    return {
      status: 200,
      message: "Tool schemas retrieved successfully",
      schemas: schemas,
      context: context
    };

  } catch (error) {
    console.error("Error fetching tool schemas:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

async function executeToolFunction(executionData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const configCollection = database.collection("clientToolConfigs");
    const registryCollection = database.collection("toolsRegistry");
    const logsCollection = database.collection("toolExecutionLogs");

    const { client_id, function_name, arguments: functionArgs, config_id, context } = executionData;

    // Find the configuration
    let config;
    if (config_id) {
      config = await configCollection.findOne({
        _id: new ObjectId(config_id),
        client_id: client_id,
        enabled: true,
        active: true
      });
    } else {
      // Extract tool name from function name (assuming format: toolname_configname)
      const toolName = function_name.split('_')[0];
      config = await configCollection.findOne({
        client_id: client_id,
        tool_name: toolName,
        enabled: true,
        active: true
      });
    }

    if (!config) {
      return {
        status: 404,
        message: "Tool configuration not found or disabled"
      };
    }

    // Get tool registry entry
    const tool = await registryCollection.findOne({
      name: config.tool_name,
      active: true
    });

    if (!tool) {
      return {
        status: 404,
        message: "Tool not found in registry"
      };
    }

    // Prepare API call
    const startTime = Date.now();
    let executionResult;
    let status = "pending";
    let errorMessage = null;

    try {
      // Build API request
      const apiRequest = await buildApiRequest(tool, config, functionArgs);
      
      // Execute API call
      const response = await axios(apiRequest);
      
      executionResult = {
        status_code: response.status,
        data: response.data,
        headers: response.headers
      };
      status = "success";

    } catch (error) {
      console.error("Tool execution error:", error);
      errorMessage = error.message;
      status = "failed";
      
      executionResult = {
        error: error.message,
        status_code: error.response?.status || 500,
        data: error.response?.data || null
      };
    }

    const executionTime = Date.now() - startTime;

    // Log execution
    await logsCollection.insertOne({
      client_id: client_id,
      config_id: config._id,
      tool_name: config.tool_name,
      function_name: function_name,
      execution_context: context || {},
      request_data: functionArgs,
      response_data: executionResult,
      status: status,
      error_message: errorMessage,
      execution_time_ms: executionTime,
      executed_at: new Date()
    });

    return {
      status: status === "success" ? 200 : 500,
      message: status === "success" ? "Tool executed successfully" : "Tool execution failed",
      result: executionResult,
      execution_time_ms: executionTime,
      config_used: {
        config_id: config._id.toString(),
        config_name: config.config_name,
        tool_name: config.tool_name
      }
    };

  } catch (error) {
    console.error("Error executing tool function:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

// Helper function to build API request from tool config and arguments
async function buildApiRequest(tool, config, functionArgs) {
  const endpointConfig = tool.endpoint_config;
  
  // Build URL
  const url = `${endpointConfig.base_url}${endpointConfig.path}`;
  
  // Build headers
  const headers = { ...endpointConfig.headers };
  
  // Add authentication
  if (endpointConfig.auth_type && config.credentials) {
    switch (endpointConfig.auth_type) {
      case 'bearer':
        if (config.credentials.api_token) {
          headers['Authorization'] = `Bearer ${config.credentials.api_token}`;
        }
        break;
      case 'api_key':
        if (config.credentials.api_key) {
          headers['X-API-Key'] = config.credentials.api_key;
        }
        break;
      case 'basic':
        if (config.credentials.username && config.credentials.password) {
          const auth = Buffer.from(`${config.credentials.username}:${config.credentials.password}`).toString('base64');
          headers['Authorization'] = `Basic ${auth}`;
        }
        break;
    }
  }

  // Merge function arguments with config parameters
  const requestData = {
    ...config.parameters,
    ...functionArgs
  };

  return {
    method: endpointConfig.method,
    url: url,
    headers: headers,
    data: requestData,
    timeout: 30000 // 30 second timeout
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

async function validateToolConfig(configData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const registryCollection = database.collection("toolsRegistry");

    // Validate required fields
    const requiredFields = ['tool_name', 'enabled'];
    const missingFields = requiredFields.filter(field => configData[field] === undefined);
    
    if (missingFields.length > 0) {
      return {
        status: 400,
        message: `Missing required fields: ${missingFields.join(', ')}`
      };
    }

    // Validate tool exists
    const tool = await registryCollection.findOne({
      name: configData.tool_name,
      active: true
    });

    if (!tool) {
      return {
        status: 400,
        message: `Tool "${configData.tool_name}" not found in registry`
      };
    }

    // Validate strategy
    const validStrategies = ['immediate', 'conditional', 'scheduled', 'manual'];
    if (configData.strategy && !validStrategies.includes(configData.strategy)) {
      return {
        status: 400,
        message: `Invalid strategy. Must be one of: ${validStrategies.join(', ')}`
      };
    }

    // Validate auth requirements
    if (tool.auth_requirements && configData.credentials) {
      const missingAuth = tool.auth_requirements.filter(
        requirement => !configData.credentials[requirement]
      );
      
      if (missingAuth.length > 0) {
        return {
          status: 400,
          message: `Missing authentication requirements: ${missingAuth.join(', ')}`
        };
      }
    }

    return {
      status: 200,
      message: "Configuration is valid",
      tool_info: {
        name: tool.name,
        description: tool.description,
        auth_requirements: tool.auth_requirements || []
      }
    };

  } catch (error) {
    console.error("Error validating tool configuration:", error);
    return {
      status: 500,
      message: "Internal server error",
      error: error.message
    };
  }
}

// =============================================================================
// PROVIDER-SPECIFIC FUNCTIONS
// =============================================================================

/**
 * Extract variables from WATI template components
 * @param {Array} components - Template components from WATI API
 * @returns {Array} Extracted variables with metadata
 */
function extractTemplateVariables(components) {
  const variables = [];
  const variablePattern = /\{\{(\d+)\}\}/g;
  
  components.forEach((component, compIndex) => {
    if (component.text) {
      let match;
      while ((match = variablePattern.exec(component.text)) !== null) {
        const position = match[0]; // {{1}}, {{2}}, etc.
        const variableNumber = match[1]; // 1, 2, etc.
        
        // Try to infer description from context
        let description = `Variable ${variableNumber}`;
        
        // Look for common patterns to suggest better descriptions
        const text = component.text.toLowerCase();
        if (text.includes('name') && position === '{{1}}') {
          description = 'Customer name';
        } else if (text.includes('appointment') || text.includes('time')) {
          description = 'Appointment date/time';
        } else if (text.includes('business') || text.includes('company')) {
          description = 'Business/Company name';
        } else if (text.includes('amount') || text.includes('price')) {
          description = 'Amount/Price';
        } else if (text.includes('code') || text.includes('otp')) {
          description = 'Code/OTP';
        }
        
        // Avoid duplicates
        if (!variables.find(v => v.position === position)) {
          variables.push({
            position: position,
            number: parseInt(variableNumber),
            description: description,
            required: true,
            component_type: component.type || 'BODY',
            suggested_type: inferVariableType(text, position)
          });
        }
      }
    }
  });
  
  // Sort by variable number
  return variables.sort((a, b) => a.number - b.number);
}

/**
 * Infer variable type based on context
 * @param {string} text - Template text context
 * @param {string} position - Variable position like {{1}}
 * @returns {string} Suggested variable type
 */
function inferVariableType(text, position) {
  const context = text.toLowerCase();
  
  if (context.includes('date') || context.includes('time') || context.includes('appointment')) {
    return 'datetime';
  } else if (context.includes('amount') || context.includes('price') || context.includes('cost')) {
    return 'number';
  } else if (context.includes('phone') || context.includes('mobile')) {
    return 'phone';
  } else if (context.includes('email')) {
    return 'email';
  } else if (context.includes('url') || context.includes('link')) {
    return 'url';
  } else {
    return 'string';
  }
}

/**
 * Fetch WATI WhatsApp templates for a client
 * @param {string} clientId - Client ID
 * @param {Object} filters - Filter options (language, category, status)
 * @returns {Promise<Object>} Templates data
 */
async function getWatiTemplates(clientId, filters = {}) {
  try {
    console.log(`📱 Fetching WATI templates for client ${clientId}...`);
    
    // Get client's WATI credentials
    const credentials = await TelephonyCredentialsService.getCredentials(clientId, 'wati');
    
    if (!credentials || !credentials.accessToken) {
      return {
        status: 404,
        success: false,
        message: 'WATI credentials not found for this client',
        suggestion: 'Please add your WATI credentials first using /telephony-credentials/add'
      };
    }
    
    console.log(`🔐 Using WATI credentials: accessToken available`);
    
    // Clean up access token
    let accessToken = credentials.accessToken;
    if (accessToken.startsWith('Bearer ')) {
      accessToken = accessToken.substring(7);
    }
    
    // Extract tenant ID from JWT token if no instanceId provided
    let tenantId = credentials.instanceId;
    if (!tenantId && !credentials.apiEndpoint) {
      try {
        const tokenPayload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
        tenantId = tokenPayload.tenant_id;
        console.log(`🔍 Extracted tenant ID from JWT: ${tenantId}`);
      } catch (error) {
        console.warn(`⚠️ Could not extract tenant ID from token: ${error.message}`);
      }
    }
    
    // Build WATI API URL - use the API endpoint from credentials or default
    let watiApiUrl;
    if (credentials.apiEndpoint) {
      // Use custom API endpoint if provided by client
      watiApiUrl = `${credentials.apiEndpoint}/getMessageTemplates`;
    } else if (tenantId) {
      // Use tenant-specific URL (most common case)
      watiApiUrl = `https://live-mt-server.wati.io/${tenantId}/api/v1/getMessageTemplates`;
    } else {
      // Use default endpoint structure (fallback)
      watiApiUrl = `https://live-mt-server.wati.io/api/v1/getMessageTemplates`;
    }
    
    // Make request to WATI API
    const response = await axios.get(watiApiUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });
    
    console.log(`✅ Successfully fetched ${response.data.messageTemplates?.length || 0} WATI templates`);
    
    // Process and filter templates
    let templates = response.data.messageTemplates || [];
    
    // Apply filters
    if (filters.language) {
      templates = templates.filter(t => t.language === filters.language);
    }
    
    if (filters.category) {
      templates = templates.filter(t => t.category === filters.category.toUpperCase());
    }
    
    if (filters.status) {
      templates = templates.filter(t => t.status === filters.status.toUpperCase());
    }
    
    // Transform templates for frontend consumption
    const processedTemplates = templates.map(template => {
      const variables = extractTemplateVariables(template.components || []);
      const templateName = template.name || template.elementName || 'unnamed_template';
      
      return {
        name: templateName,
        elementName: template.elementName || templateName,
        category: template.category,
        language: template.language,
        status: template.status,
        components: template.components || [],
        variables: variables,
        variableCount: variables.length,
        createdOn: template.createdOn,
        modifiedOn: template.modifiedOn,
        namespace: template.namespace,
        // Additional metadata for tool creation
        toolSuggestion: {
          functionName: `send_${templateName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          description: `Send ${templateName} WhatsApp template message`,
          hasVariables: variables.length > 0,
          isApproved: template.status === 'APPROVED'
        }
      };
    });
    
    // Sort by status (APPROVED first) and then by name
    processedTemplates.sort((a, b) => {
      if (a.status === 'APPROVED' && b.status !== 'APPROVED') return -1;
      if (a.status !== 'APPROVED' && b.status === 'APPROVED') return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    
    return {
      status: 200,
      success: true,
      message: 'WATI templates retrieved successfully',
      templates: processedTemplates,
      count: processedTemplates.length,
      totalCount: response.data.messageTemplates?.length || 0,
      filters: filters,
      metadata: {
        apiEndpoint: watiApiUrl,
        instanceId: credentials.instanceId || null,
        fetchedAt: new Date().toISOString(),
        isClientSpecific: credentials.isClientSpecific || false
      }
    };
    
  } catch (error) {
    console.error('❌ Error fetching WATI templates:', error);
    
    // Handle specific error cases
    if (error.response) {
      const statusCode = error.response.status;
      const errorData = error.response.data;
      
      if (statusCode === 401) {
        return {
          status: 401,
          success: false,
          message: 'WATI authentication failed',
          error: 'Invalid access token or expired credentials',
          suggestion: 'Please update your WATI credentials'
        };
      } else if (statusCode === 403) {
        return {
          status: 403,
          success: false,
          message: 'WATI access forbidden',
          error: 'Insufficient permissions to access templates',
          suggestion: 'Check your WATI account permissions'
        };
      } else if (statusCode === 404) {
        return {
          status: 404,
          success: false,
          message: 'WATI instance not found',
          error: 'Invalid instance ID or instance not accessible',
          suggestion: 'Verify your WATI instance ID'
        };
      }
      
      return {
        status: statusCode,
        success: false,
        message: 'WATI API error',
        error: errorData?.message || error.message,
        details: errorData
      };
    }
    
    if (error.code === 'ECONNABORTED') {
      return {
        status: 408,
        success: false,
        message: 'Request timeout',
        error: 'WATI API request timed out',
        suggestion: 'Please try again later'
      };
    }
    
    return {
      status: 500,
      success: false,
      message: 'Internal server error while fetching WATI templates',
      error: error.message,
      suggestion: 'Please check your network connection and try again'
    };
  }
}

module.exports = {
  // Tools Registry Management
  createToolRegistry,
  getToolsRegistry,
  getToolRegistryById,
  updateToolRegistry,
  deleteToolRegistry,
  
  // Client Tool Configurations
  createClientToolConfig,
  getClientToolConfigs,
  getClientToolConfigById,
  updateClientToolConfig,
  deleteClientToolConfig,
  
  // Tool Orchestration
  getToolsSchemas,
  executeToolFunction,
  
  // Utility
  validateToolConfig,
  
  // Provider-specific
  getWatiTemplates
};