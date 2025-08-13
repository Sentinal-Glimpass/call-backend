# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory in container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Install babel dependencies globally for production
RUN npm install -g @babel/node @babel/core

# Copy application code
COPY . .

# Create uploads directory if it doesn't exist
RUN mkdir -p uploads list-uploads

# Expose port 8080
EXPOSE 8080

# Set environment variable for port
ENV PORT=8080

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of app directory to nodejs user
RUN chown -R nodejs:nodejs /app
USER nodejs

# Start the application
CMD ["npm", "start"]