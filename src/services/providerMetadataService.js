/**
 * Provider Metadata Service
 * Centralized configuration for all telephony providers
 * Provides dynamic field definitions for frontend form generation
 */

class ProviderMetadataService {
  
  /**
   * Get all available providers with their configurations
   * @returns {Object} All provider configurations
   */
  static getAllProviders() {
    return {
      plivo: {
        name: "plivo",
        displayName: "Plivo Voice & SMS",
        description: "Voice calls and SMS messaging via Plivo platform",
        isDefault: true,
        capabilities: ["voice", "sms"],
        category: "telephony",
        logoUrl: "/assets/providers/plivo-logo.svg",
        docsUrl: "https://www.plivo.com/docs/",
        
        requiredFields: [
          {
            key: "accountSid",
            label: "Account SID",
            type: "text",
            placeholder: "MAXXXXXXXXXXXXXXXXXX",
            validation: {
              pattern: "^[A-Z0-9]{20}$",
              message: "Must be exactly 20 alphanumeric characters"
            },
            helpText: "20-character Account SID from Plivo console",
            order: 1
          },
          {
            key: "authToken",
            label: "Auth Token", 
            type: "password",
            validation: {
              minLength: 10,
              message: "Auth token must be at least 10 characters"
            },
            helpText: "Authentication token from Plivo console",
            order: 2
          }
        ],
        
        optionalFields: [
          {
            key: "phoneNumbers",
            label: "Phone Numbers",
            type: "array",
            placeholder: "+918035735659, +918035735660",
            helpText: "Comma-separated list of phone numbers owned by this account",
            order: 3
          },
          {
            key: "region",
            label: "Region",
            type: "select",
            options: [
              { value: "global", label: "Global" },
              { value: "india", label: "India" },
              { value: "us", label: "United States" }
            ],
            defaultValue: "global",
            order: 4
          }
        ]
      },

      twilio: {
        name: "twilio",
        displayName: "Twilio Communications Platform",
        description: "Voice, SMS, and WhatsApp messaging via Twilio",
        isDefault: false,
        capabilities: ["voice", "sms", "whatsapp"],
        category: "telephony",
        logoUrl: "/assets/providers/twilio-logo.svg", 
        docsUrl: "https://www.twilio.com/docs/",
        
        requiredFields: [
          {
            key: "accountSid",
            label: "Account SID",
            type: "text",
            placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            validation: {
              pattern: "^AC[a-f0-9A-F]{32}$",
              message: "Must start with 'AC' followed by 32 hex characters"
            },
            helpText: "Account SID starting with 'AC' from Twilio Console",
            order: 1
          },
          {
            key: "authToken",
            label: "Auth Token",
            type: "password", 
            validation: {
              minLength: 32,
              maxLength: 32,
              message: "Auth token must be exactly 32 characters"
            },
            helpText: "32-character authentication token from Twilio Console",
            order: 2
          }
        ],
        
        optionalFields: [
          {
            key: "phoneNumbers",
            label: "Phone Numbers", 
            type: "array",
            placeholder: "+18005551234, +18005556789",
            helpText: "Comma-separated Twilio phone numbers",
            order: 3
          },
          {
            key: "whatsappNumbers",
            label: "WhatsApp Numbers",
            type: "array", 
            placeholder: "whatsapp:+14155238886",
            helpText: "WhatsApp Business numbers (include 'whatsapp:' prefix)",
            order: 4
          }
        ]
      },

      wati: {
        name: "wati",
        displayName: "WATI WhatsApp Business API",
        description: "WhatsApp Business messaging via WATI platform", 
        isDefault: false,
        capabilities: ["whatsapp"],
        category: "messaging",
        logoUrl: "/assets/providers/wati-logo.svg",
        docsUrl: "https://documenter.getpostman.com/view/2712925/SzYUagbA",
        
        requiredFields: [
          {
            key: "accessToken",
            label: "Access Token",
            type: "password",
            validation: {
              minLength: 20,
              message: "Access token must be at least 20 characters"
            },
            helpText: "API access token from WATI dashboard",
            order: 1
          }
        ],
        
        optionalFields: [
          {
            key: "apiEndpoint",
            label: "API Endpoint",
            type: "url",
            placeholder: "https://your-domain.wati.io/api/v1",
            helpText: "Your WATI API endpoint URL from dashboard (leave empty to use default)",
            order: 2
          },
          {
            key: "instanceId", 
            label: "Instance ID (Legacy)",
            type: "text",
            placeholder: "your_instance_id",
            validation: {
              pattern: "^[a-zA-Z0-9_-]*$",
              message: "Only alphanumeric characters, underscores, and hyphens allowed"
            },
            helpText: "Legacy instance ID - only needed for older WATI setups",
            order: 3
          },
          {
            key: "webhookUrl",
            label: "Webhook URL",
            type: "url",
            placeholder: "https://your-domain.com/wati/webhook",
            helpText: "URL for receiving WATI webhook notifications",
            order: 4
          }
        ]
      }
    };
  }

  /**
   * Get configuration for a specific provider
   * @param {string} providerName - Provider identifier
   * @returns {Object} Provider configuration
   */
  static getProviderConfig(providerName) {
    const providers = this.getAllProviders();
    return providers[providerName] || null;
  }

  /**
   * Get form fields for a provider (for frontend form generation)
   * @param {string} providerName - Provider identifier
   * @returns {Array} Combined required and optional fields
   */
  static getProviderFields(providerName) {
    const config = this.getProviderConfig(providerName);
    if (!config) return [];

    return [
      ...config.requiredFields.map(field => ({ ...field, required: true })),
      ...config.optionalFields.map(field => ({ ...field, required: false }))
    ].sort((a, b) => a.order - b.order);
  }

  /**
   * Validate credentials for a specific provider
   * @param {string} providerName - Provider identifier  
   * @param {Object} credentials - Credentials to validate
   * @returns {Object} Validation result
   */
  static validateCredentials(providerName, credentials) {
    const config = this.getProviderConfig(providerName);
    if (!config) {
      return { valid: false, error: `Unknown provider: ${providerName}` };
    }

    const errors = [];

    // Validate required fields
    for (const field of config.requiredFields) {
      const value = credentials[field.key];
      
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors.push(`${field.label} is required`);
        continue;
      }

      // Pattern validation
      if (field.validation?.pattern) {
        const regex = new RegExp(field.validation.pattern);
        if (!regex.test(value)) {
          errors.push(`${field.label}: ${field.validation.message}`);
        }
      }

      // Length validation
      if (field.validation?.minLength && value.length < field.validation.minLength) {
        errors.push(`${field.label} must be at least ${field.validation.minLength} characters`);
      }
      
      if (field.validation?.maxLength && value.length > field.validation.maxLength) {
        errors.push(`${field.label} must be at most ${field.validation.maxLength} characters`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Get providers by capability
   * @param {string} capability - Capability to filter by
   * @returns {Array} Providers supporting the capability
   */
  static getProvidersByCapability(capability) {
    const providers = this.getAllProviders();
    return Object.entries(providers)
      .filter(([_, config]) => config.capabilities.includes(capability))
      .map(([name, config]) => ({ name, ...config }));
  }

  /**
   * Get default provider for a capability
   * @param {string} capability - Capability type
   * @returns {string} Default provider name
   */
  static getDefaultProvider(capability) {
    const providers = this.getProvidersByCapability(capability);
    const defaultProvider = providers.find(p => p.isDefault);
    return defaultProvider?.name || providers[0]?.name || null;
  }

  /**
   * Get supported capabilities across all providers
   * @returns {Array} List of all supported capabilities
   */
  static getAllCapabilities() {
    const providers = this.getAllProviders();
    const capabilities = new Set();
    
    Object.values(providers).forEach(config => {
      config.capabilities.forEach(cap => capabilities.add(cap));
    });
    
    return Array.from(capabilities);
  }

  /**
   * Get provider categories
   * @returns {Array} List of provider categories
   */
  static getCategories() {
    const providers = this.getAllProviders();
    const categories = new Set();
    
    Object.values(providers).forEach(config => {
      categories.add(config.category);
    });
    
    return Array.from(categories);
  }
}

module.exports = ProviderMetadataService;