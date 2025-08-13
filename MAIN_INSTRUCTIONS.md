# Main Instructions for AI Development Agent

## Overview
This document provides comprehensive instructions for an AI development agent to implement the enhanced telephony system using the provided documentation. The agent should follow these instructions meticulously to ensure consistent, high-quality implementation.

## Core Documentation Reference
The agent must always reference these key documents:
- **CALL_LOGIC.md**: Contains the complete system architecture and logical flow
- **IMPLEMENTATION_PLAN.md**: Provides step-by-step implementation roadmap  
- **NOTES.md**: Repository for findings, decisions, and key insights

## Implementation Methodology

### Step-by-Step Approach
1. **Read the Implementation Plan**: Always start by reviewing the current phase and specific step
2. **Check Current Status**: Verify if the step is marked as implemented, partially implemented, or not implemented
3. **Reference Call Logic**: Understand the expected behavior from CALL_LOGIC.md
4. **Plan Before Coding**: Write plan in NOTES.md before implementing
5. **Implement Incrementally**: Write code in small, testable chunks
6. **Test Immediately**: Test each component as it's built
7. **Document Findings**: Record any discoveries, issues, or decisions in NOTES.md
8. **Update Status**: Mark completion status in implementation plan

### Development Principles
- **Database-First Design**: All state must be stored in MongoDB for Cloud Run compatibility
- **Serverless-Ready**: Design for stateless containers that can restart anytime
- **Error-Resilient**: Every component must handle failures gracefully
- **Test-Driven**: Write tests or validation scripts alongside implementation
- **Documentation-Driven**: Update documentation when making architectural decisions

## Phase Implementation Guidelines

### Phase 1: Preparation & Database Schema
**Objective**: Establish foundation infrastructure

**Before Starting Each Step**:
- Review existing database collections and schemas
- Identify current environment variables
- Test database connectivity and permissions

**Implementation Pattern**:
- Create validation scripts before making changes
- Test schema changes with sample data
- Verify backward compatibility where applicable

**Key Deliverables**:
- Updated .env with all required variables
- Database validation scripts
- Schema migration scripts where needed

### Phase 2: Core Infrastructure
**Objective**: Build fundamental system components

**Implementation Pattern**:
- Start with utility functions (concurrency checking, call tracking)
- Create database helper functions
- Build middleware and validation layers
- Integrate with existing webhook handlers

**Testing Requirements**:
- Unit tests for concurrency logic
- Database operation tests
- Integration tests with existing components

### Phase 3: Campaign Management
**Objective**: Implement advanced campaign features

**Critical Considerations**:
- Maintain backward compatibility with existing campaigns
- Ensure atomic database operations for campaign state changes
- Handle edge cases (empty lists, invalid data, concurrent modifications)

**Integration Points**:
- Single call processing must work for both APIs and campaigns
- Existing campaign endpoints should be enhanced, not replaced
- Webhook handlers must support both old and new tracking methods

### Phase 4: Pause/Resume Functionality
**Objective**: Add campaign control capabilities

**State Management**:
- Campaign status changes must be atomic
- Progress tracking must be accurate and resumable
- Multiple pause/resume requests must be handled gracefully

**User Experience Considerations**:
- Provide clear feedback on campaign status changes
- Include progress percentages and time estimates
- Handle concurrent pause/resume requests safely

### Phase 5: Cloud Run Optimization
**Objective**: Ensure serverless compatibility

**Container Lifecycle Handling**:
- Implement graceful shutdown procedures
- Create startup recovery mechanisms
- Handle container scaling scenarios

**Heartbeat System**:
- Heartbeats must be reliable and consistent
- Orphaned campaign detection must be accurate
- Recovery processes must be idempotent

## Testing Strategy

### Unit Testing
- Test individual functions with mocked dependencies
- Focus on business logic and edge cases
- Use sample data that mirrors production scenarios

### Integration Testing
- Test complete workflows end-to-end
- Verify database operations under concurrent load
- Test webhook processing with actual Plivo-like payloads

### System Testing
- Test campaign lifecycle (create → process → pause → resume → complete)
- Verify concurrency limits are enforced correctly
- Test orphaned campaign recovery scenarios

### Performance Testing
- Validate database query performance with indexes
- Test memory usage during long-running campaigns
- Verify system behavior under high concurrent load

## Code Quality Standards

### File Organization
- Place utility functions in `src/utils/`
- Database operations in `src/services/`
- API endpoints in `src/routes/`
- Middleware in `src/middleware/`

### Error Handling
- Every async function must have try-catch blocks
- Database errors should be logged with context
- User-facing errors should be descriptive but not expose internals
- Failed operations should not leave system in inconsistent state

### Logging Standards
- Use structured logging with consistent format
- Include correlation IDs for tracking requests
- Log important state changes (campaign status, concurrency changes)
- Avoid logging sensitive data (phone numbers, client details)

### Documentation Requirements
- Update function comments for complex business logic
- Maintain API documentation (Swagger) for new endpoints
- Document any architectural decisions in NOTES.md
- Update README if new setup steps are required

## Notes Management Protocol

### What to Record in NOTES.md
- **Design Decisions**: Why certain approaches were chosen over alternatives
- **Implementation Challenges**: Problems encountered and solutions found
- **Database Schema Changes**: What was modified and why
- **Performance Insights**: Query optimization discoveries
- **Integration Issues**: Problems with existing code and resolutions
- **Testing Results**: Key findings from testing activities
- **Future Considerations**: Ideas for improvement or potential issues

### Note Format
Use clear headings and timestamps:
```
## [Date] - [Phase X.Y] - [Topic]
**Context**: What was being implemented
**Issue/Finding**: What was discovered
**Solution/Decision**: How it was resolved
**Impact**: What this means for the system
**Next Steps**: Any follow-up required
```

## Communication with User

### Progress Updates
- Provide clear status updates when completing major steps
- Explain any deviations from the implementation plan
- Ask for clarification when requirements are ambiguous
- Report any blocking issues immediately

### Code Presentation
- Show key code snippets when explaining complex logic
- Focus on business logic rather than boilerplate
- Explain architectural decisions and trade-offs
- Highlight any assumptions made during implementation

### Problem Escalation
If encountering issues:
1. Document the problem clearly in NOTES.md
2. Research potential solutions
3. Present options with pros/cons to user
4. Wait for guidance before proceeding with major architectural changes

## Success Criteria

### Step Completion Checklist
- [ ] Implementation matches CALL_LOGIC.md specifications
- [ ] Code follows established patterns in codebase
- [ ] Error handling is comprehensive
- [ ] Database operations are atomic and safe
- [ ] Integration tests pass
- [ ] Documentation is updated
- [ ] Findings are recorded in NOTES.md
- [ ] Implementation plan status is updated

### Phase Completion Validation
- All steps in phase are marked complete
- Integration testing across phase components passes
- No regression in existing functionality
- Performance meets expected standards
- Documentation accurately reflects implementation

## Getting Started

1. **Read all documentation**: CALL_LOGIC.md and IMPLEMENTATION_PLAN.md thoroughly
2. **Set up environment**: Ensure all required environment variables are configured
3. **Validate current state**: Run existing tests to ensure baseline functionality
4. **Start with Phase 1**: Begin with Step 1.1 (Environment Variables Setup)
5. **Follow the methodology**: Plan → Implement → Test → Document → Update Status

Remember: The goal is to build a robust, scalable telephony system that works reliably in a serverless environment. Quality and reliability are more important than speed of implementation.