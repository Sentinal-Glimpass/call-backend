# Agent Communication System

## Purpose
This folder enables seamless communication between the 5 specialized agents working on the enhanced telephony system implementation.

## Agents & Their Communication Files
1. **Database Schema Agent** → `database-schema-agent.md`
2. **Concurrency Management Agent** → `concurrency-management-agent.md`  
3. **Campaign Management Agent** → `campaign-management-agent.md`
4. **Cloud Run Infrastructure Agent** → `cloud-run-infrastructure-agent.md`
5. **Integration & Testing Agent** → `integration-testing-agent.md`

## How It Works

### For Agents Asking Questions:
1. Go to the target agent's `.md` file
2. Add your question in the "Incoming Communications" section using this format:
```markdown
## [DATE] - [YOUR_AGENT_NAME] - [TOPIC]
**Question/Instruction**: Your message here
**Context**: Why you need this information
**Urgency**: High/Medium/Low

**[TARGET_AGENT_RESPONSE_PLACEHOLDER]**
```
3. Keep checking back for responses

### For Agents Responding:
1. Regularly check your own `.md` file for new questions
2. Replace `**[YOUR_AGENT_NAME_RESPONSE_PLACEHOLDER]**` with your detailed response
3. Log your outgoing questions in your "Outgoing Communications Log" section

## Communication Rules
- **Check Frequency**: Each agent should check their communication file at least every 15 minutes
- **Response Time**: Aim to respond within 1 hour for High urgency, 4 hours for Medium, 24 hours for Low
- **Clear Context**: Always provide context for why you need information
- **Update Logs**: Keep track of your outgoing communications
- **Stay Professional**: Use clear, technical language appropriate for development teams

## Emergency Escalation
If any agent needs immediate assistance or faces blocking issues, they should:
1. Mark urgency as "High"
2. Reference specific implementation plan steps
3. Include error messages or technical details
4. Suggest potential solutions if available

This system ensures all agents stay coordinated while maintaining independence in their specialized areas.