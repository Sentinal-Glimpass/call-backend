# Call Backend Deployment Guide

This guide covers deploying the call-backend application using Docker.

## 🐳 Docker Deployment

### Prerequisites
- Docker installed on your system
- Environment variables configured
- MongoDB Atlas connection available
- Redis instance available (optional but recommended)

### Build Docker Image
```bash
# Build the Docker image
docker build -t call-backend .

# Verify the image was created
docker images | grep call-backend
```

### Run with Docker
```bash
# Run the container on port 8080
docker run -d \
  --name call-backend \
  -p 8080:8080 \
  --env-file .env \
  call-backend

# Check if container is running
docker ps

# View logs
docker logs call-backend

# Follow logs in real-time
docker logs -f call-backend
```

### Environment Variables

Create a `.env` file with the following variables:

```bash
# Server Configuration
PORT=8080

# JWT Security
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=24h

# MongoDB Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority

# Call Lifecycle Timeouts (milliseconds)
MAX_PROCESSED_TIME=60000   # 1 minute
MAX_RINGING_TIME=180000    # 3 minutes  
MAX_ONGOING_TIME=3600000   # 60 minutes

# Azure OpenAI Configuration
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_ENDPOINT=your_azure_endpoint

# Redis Configuration (Optional)
REDIS_URL=redis://redis:6379

# OpenAI Configuration
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-3.5-turbo

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=your_twilio_number

# Exotel Configuration
EXOTEL_ACCOUNT_SID=your_exotel_sid
EXOTEL_AUTH_TOKEN=your_exotel_token
EXOTEL_AUTH_KEY=your_exotel_key
EXOTEL_PHONE_NUMBER=your_exotel_number

# MarkAible AI Services
GROQ_API_KEY=your_groq_key

# Razorpay Configuration
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret

# Billing Configuration
COST_PER_MINUTE_RUPEES=10
INCOMING_AGGREGATION_TIME=3600000

# Base URL Configuration
BASE_URL=http://your-domain.com:8080

# Enhanced Telephony System Configuration
GLOBAL_MAX_CALLS=50
DEFAULT_CLIENT_MAX_CONCURRENT_CALLS=10
MAX_CONCURRENT_CALL_WAIT=5000
SUBSEQUENT_CALL_WAIT=6000

# Bot Warmup Configuration
BOT_WARMUP_URL=https://live.glimpass.com/warmup
BOT_WARMUP_TIMEOUT=60000
BOT_WARMUP_RETRIES=3
BOT_WARMUP_ENABLED=true

# Campaign & Call Management
CALL_TIMEOUT_MINUTES=10
CLEANUP_INTERVAL=300000

# Cloud Run Configuration
HEARTBEAT_INTERVAL=30000
ORPHAN_DETECTION_THRESHOLD=120000
CONTAINER_SHUTDOWN_GRACE=10000

# Rate Limiting
MAX_CALLS_PER_MINUTE=10
RATE_LIMIT_WINDOW=60000

# Monitoring Thresholds
HIGH_UTILIZATION_THRESHOLD=80
FAILED_CALL_RATE_THRESHOLD=25
```

## 🚀 Production Deployment

### Docker Compose (Recommended)
```yaml
version: '3.8'
services:
  call-backend:
    build: .
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
    env_file:
      - .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

### Cloud Deployment Options

#### Google Cloud Run
```bash
# Build and push to Google Container Registry
docker build -t gcr.io/your-project/call-backend .
docker push gcr.io/your-project/call-backend

# Deploy to Cloud Run
gcloud run deploy call-backend \
  --image gcr.io/your-project/call-backend \
  --platform managed \
  --region us-central1 \
  --port 8080 \
  --allow-unauthenticated
```

#### AWS ECS
```bash
# Build and push to Amazon ECR
docker build -t your-account.dkr.ecr.region.amazonaws.com/call-backend .
docker push your-account.dkr.ecr.region.amazonaws.com/call-backend
```

#### DigitalOcean App Platform
- Connect your GitHub repository
- Set build command: `docker build -t call-backend .`
- Set run command: `docker run -p 8080:8080 call-backend`

## 🔧 Configuration

### Health Check
The application provides a health check endpoint:
```
GET /health
```

### API Documentation
Swagger documentation is available at:
```
http://localhost:8080/api-docs
```

### Monitoring
- Application logs are sent to stdout
- Use `docker logs` to view application logs
- Set up external monitoring for production

## 🛠️ Development

### Local Development with Docker
```bash
# Build development image
docker build -t call-backend:dev .

# Run with volume mounting for live reload
docker run -d \
  --name call-backend-dev \
  -p 8080:8080 \
  -v $(pwd):/app \
  --env-file .env \
  call-backend:dev
```

### Without Docker
```bash
# Install dependencies
npm install

# Start development server
npm start

# The app will run on http://localhost:7999 (or PORT from .env)
```

## 🔒 Security Considerations

### Environment Variables
- Never commit `.env` files to version control
- Use secrets management in production
- Rotate secrets regularly

### Network Security
- Use HTTPS in production
- Configure proper CORS origins
- Implement rate limiting (see SECURITY.md)

### Container Security
- The Docker image runs as non-root user
- Minimal base image (Alpine Linux)
- Only production dependencies included

## 📊 Scaling

### Horizontal Scaling
- The application is stateless and can be scaled horizontally
- Use a load balancer to distribute traffic
- Ensure Redis is used for session storage

### Vertical Scaling
- Monitor CPU and memory usage
- Adjust container resources as needed
- Consider connection pooling limits

## 🔍 Troubleshooting

### Common Issues

#### Container won't start
```bash
# Check logs
docker logs call-backend

# Check if port is available
netstat -tlnp | grep 8080

# Verify environment variables
docker exec call-backend env | grep PORT
```

#### Database connection issues
```bash
# Test MongoDB connection
docker exec call-backend node -e "
const { MongoClient } = require('mongodb');
MongoClient.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err.message));
"
```

#### Performance issues
```bash
# Monitor container resources
docker stats call-backend

# Check application metrics
curl http://localhost:8080/health
```

## 📈 Production Checklist

- [ ] Environment variables configured
- [ ] Database connections tested
- [ ] Health checks configured
- [ ] Logging set up
- [ ] Monitoring configured
- [ ] Backup strategy in place
- [ ] Security headers configured
- [ ] Rate limiting implemented
- [ ] SSL/TLS certificates configured
- [ ] Load balancer configured (if needed)

## 🚨 Emergency Procedures

### Stop Application
```bash
docker stop call-backend
```

### Restart Application
```bash
docker restart call-backend
```

### Emergency Rollback
```bash
# Stop current version
docker stop call-backend
docker rm call-backend

# Start previous version
docker run -d --name call-backend -p 8080:8080 --env-file .env call-backend:previous
```

---

For security implementation details, see [SECURITY.md](./SECURITY.md)
For development guidelines, see [CLAUDE.md](./CLAUDE.md)