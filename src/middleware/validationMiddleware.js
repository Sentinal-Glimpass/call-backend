/**
 * Input Validation Middleware
 * Provides comprehensive validation for API endpoints
 */

const validator = require('validator');

// Common validation patterns
const VALIDATION_PATTERNS = {
  mongoId: /^[0-9a-fA-F]{24}$/,
  phoneNumber: /^[\+]?[1-9]?\d{9,15}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  campaignId: /^[a-zA-Z0-9\-_]{1,50}$/,
  filename: /^[a-zA-Z0-9\-_\.]{1,100}$/,
  alphanumeric: /^[a-zA-Z0-9\s\-_\.]+$/
};

// Sanitization functions
const sanitizers = {
  // Remove potentially dangerous characters
  sanitizeString: (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/[<>\"'%;()&+]/g, '').trim();
  },

  // Sanitize phone number
  sanitizePhone: (phone) => {
    if (typeof phone !== 'string') return phone;
    return phone.replace(/[^\d\+]/g, '');
  },

  // Sanitize filename
  sanitizeFilename: (filename) => {
    if (typeof filename !== 'string') return filename;
    return filename.replace(/[^a-zA-Z0-9\-_\.]/g, '').substring(0, 100);
  }
};

// Validation functions
const validators = {
  isValidMongoId: (id) => VALIDATION_PATTERNS.mongoId.test(id),
  isValidPhone: (phone) => VALIDATION_PATTERNS.phoneNumber.test(phone),
  isValidEmail: (email) => VALIDATION_PATTERNS.email.test(email),
  isValidCampaignId: (id) => VALIDATION_PATTERNS.campaignId.test(id),
  isValidFilename: (name) => VALIDATION_PATTERNS.filename.test(name),
  isValidAlphanumeric: (str) => VALIDATION_PATTERNS.alphanumeric.test(str),
  
  // Length validations
  isValidLength: (str, min = 1, max = 255) => {
    return typeof str === 'string' && str.length >= min && str.length <= max;
  },

  // Number validations
  isValidPositiveInteger: (num) => {
    const parsed = parseInt(num);
    return !isNaN(parsed) && parsed > 0 && parsed <= 999999;
  },

  isValidPositiveNumber: (num) => {
    const parsed = parseFloat(num);
    return !isNaN(parsed) && parsed >= 0 && parsed <= 999999999;
  }
};

// Create validation schema middleware
const createValidationMiddleware = (schema) => {
  return (req, res, next) => {
    const errors = [];
    
    // Validate and sanitize request data
    ['body', 'query', 'params'].forEach(source => {
      const data = req[source];
      const schemaRules = schema[source];
      
      if (!schemaRules || !data) return;
      
      Object.keys(schemaRules).forEach(field => {
        const rules = schemaRules[field];
        const value = data[field];
        
        // Check required fields
        if (rules.required && (value === undefined || value === null || value === '')) {
          errors.push(`${field} is required`);
          return;
        }
        
        // Skip validation if field is not required and not provided
        if (!rules.required && (value === undefined || value === null || value === '')) {
          return;
        }
        
        // Apply sanitization first
        if (rules.sanitize && value !== undefined) {
          const sanitizer = sanitizers[rules.sanitize];
          if (sanitizer) {
            data[field] = sanitizer(value);
          }
        }
        
        // Apply validations
        if (rules.validate && value !== undefined) {
          const validationRules = Array.isArray(rules.validate) ? rules.validate : [rules.validate];
          
          validationRules.forEach(rule => {
            if (typeof rule === 'string') {
              // Use predefined validator
              const validator = validators[rule];
              if (validator && !validator(data[field])) {
                errors.push(`${field} has invalid format`);
              }
            } else if (typeof rule === 'function') {
              // Custom validation function
              const result = rule(data[field]);
              if (result !== true) {
                errors.push(typeof result === 'string' ? result : `${field} is invalid`);
              }
            }
          });
        }
        
        // Length validation
        if (rules.minLength || rules.maxLength) {
          const min = rules.minLength || 0;
          const max = rules.maxLength || 999999;
          if (!validators.isValidLength(data[field], min, max)) {
            errors.push(`${field} must be between ${min} and ${max} characters`);
          }
        }
      });
    });
    
    if (errors.length > 0) {
      return res.status(400).json({
        status: 400,
        message: 'Validation failed',
        errors: errors
      });
    }
    
    next();
  };
};

// Common validation schemas
const commonSchemas = {
  mongoIdParam: {
    params: {
      id: {
        required: true,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      }
    }
  },
  
  phoneValidation: {
    body: {
      number: {
        required: true,
        validate: 'isValidPhone',
        sanitize: 'sanitizePhone'
      }
    }
  },
  
  campaignValidation: {
    body: {
      camp_name: {
        required: true,
        validate: 'isValidAlphanumeric',
        sanitize: 'sanitizeString',
        minLength: 1,
        maxLength: 100
      }
    }
  },
  
  csvUploadValidation: {
    body: {
      list_name: {
        required: true,
        validate: 'isValidAlphanumeric',
        sanitize: 'sanitizeString',
        minLength: 1,
        maxLength: 100
      }
    }
  },
  
  paginationValidation: {
    query: {
      page: {
        required: false,
        validate: 'isValidPositiveInteger'
      },
      limit: {
        required: false,
        validate: 'isValidPositiveInteger'
      }
    }
  }
};

module.exports = {
  createValidationMiddleware,
  validators,
  sanitizers,
  commonSchemas,
  VALIDATION_PATTERNS
};