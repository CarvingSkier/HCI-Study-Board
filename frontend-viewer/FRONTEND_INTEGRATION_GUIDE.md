# Frontend Integration Guide: Activation Steering Workflow

## Overview

This document describes the WebSocket-based communication protocol between the frontend (UI) and the backend (model server) for the Activation Steering Workflow system. The frontend connects to a WebSocket bridge server that relays messages between the UI and the model server.

## Architecture

```
Frontend (Browser)  ←→  WebSocket Bridge Server  ←→  Model Server
     (UI)                    (Relay)              (workflow_user.py)
```

- **Frontend** connects to: `ws://BRIDGE_HOST:PORT/ui`
- **Model Server** connects to: `ws://BRIDGE_HOST:PORT/model`
- **Bridge Server** relays all JSON messages between UI and Model Server

## Connection Setup

### 1. Connect to Bridge Server

**Important**: Use `wss://` (secure WebSocket) if your frontend is served over HTTPS (e.g., GitHub Pages). Use `ws://` only for HTTP or local development. 

**VPS-Domain IP: 137.184.192.144**

```javascript
// For production (HTTPS frontend → WSS bridge)
const socket = new WebSocket('wss://your-vps-domain.com:8765/ui');

// For development (HTTP frontend → WS bridge)
const socket = new WebSocket('ws://localhost:8765/ui');

socket.onopen = () => {
  console.log('Connected to bridge server');
};

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleMessage(message);
};

socket.onerror = (error) => {
  console.error('WebSocket error:', error);
};

socket.onclose = () => {
  console.log('Connection closed');
};
```

## Workflow Protocol

The workflow consists of 5 main steps:

### Step 1: Hello & Session Start

**Purpose**: Initialize a new session or resume an existing one.

#### New Session

**Frontend sends:**
```json
{
  "type": "hello",
  "user_id": "unique_user_identifier"
}
```

**Frontend receives:**
```json
{
  "type": "hello_confirm",
  "user_id": "unique_user_identifier",
  "status": "ready"
}
```

#### Resume Session

**Frontend sends:**
```json
{
  "type": "hello",
  "user_id": "unique_user_identifier",
  "resume": true
}
```

**Note**: The `resume` field accepts both boolean (`true`/`false`) and string values (`"true"`, `"resume"`, `"1"`, `"yes"`). Boolean `true` is recommended.

**Frontend receives (if user found):**
```json
{
  "type": "resume_confirm",
  "user_id": "unique_user_identifier",
  "method": "activation_steering",
  "interaction_count": 5,
  "status": "ready"
}
```

**Frontend receives (if user not found):**
```json
{
  "type": "error",
  "code": "USER_NOT_FOUND",
  "message": "User unique_user_identifier not found in session logs. Please start a new session."
}
```

**Notes:**
- `user_id` must be unique per user
- For resume, the backend automatically loads the method and interaction count
- If resume fails, frontend should allow user to start a new session

---

### Step 2: Method Selection (New Sessions Only)

**Purpose**: Select the interaction method. **Skip this step for resume sessions** (method is auto-loaded).

**Frontend sends:**
```json
{
  "type": "method",
  "method": "vanilla" | "activation_steering" | "combined"
}
```

**Frontend receives (if valid):**
```json
{
  "type": "method_confirm",
  "method": "activation_steering",
  "status": "ready"
}
```

**Frontend receives (if invalid):**
```json
{
  "type": "error",
  "code": "INVALID_METHOD",
  "message": "Method must be one of ['vanilla', 'activation_steering', 'combined'], got: invalid_method",
  "valid_methods": ["vanilla", "activation_steering", "combined"]
}
```

**Method Descriptions:**
- **`vanilla`**: Base model without LoRA adapter, simple interaction generation
- **`activation_steering`**: Uses PAS (Probe, Align, Steer) approach with activation steering
  - First 3 interactions: Uses vanilla generation but collects steering data
  - From 4th interaction: Uses activation steering for generation
- **`combined`**: Randomly selects vanilla or activation_steering for each interaction

**Notes:**
- Frontend should retry with a valid method if error is received
- Method cannot be changed during a session

---

### Step 3: Send Context & Receive Response

**Purpose**: Send a context scenario and receive an AI-generated response.

**Frontend sends:**
```json
{
  "type": "context",
  "payload": {
    "scenario_text": "Cooking dinner in the kitchen (timing_interruption)",
    "timeframe": "2024-01-15 18:00 - 2024-01-15 19:30"
  }
}
```

**Frontend receives:**
```json
{
  "type": "response",
  "response": "I notice you're cooking dinner. Would you like me to set a timer or help with any recipes?",
  "interaction_count": 1
}
```

**Field Descriptions:**
- `scenario_text`: Description of the user's current activity/context. Can include category hint in parentheses, e.g., `(timing_interruption)`
- `timeframe`: Time range for the activity, format: `"START_TIME - END_TIME"` or just `"START_TIME"`
- `response`: The AI-generated natural language response
- `interaction_count`: Current interaction number in this session

**Notes:**
- Frontend should wait for response before sending another context
- Response may take a few seconds depending on model load
- `interaction_count` increments with each interaction

---

### Step 4: Send User Feedback

**Purpose**: Provide user feedback on the AI response to improve future interactions.

**Frontend sends:**
```json
{
  "type": "feedback",
  "payload": {
    "choice": "YES" | "NO",
    "response": "User's preferred response or N/A",
    "satisfaction_survey": "Q1:4 Q2:5 Q3:4 Q4:5 Q5:4",
    "mark": "Category-specific feedback or NONE",
    "category_ranking": ["timing_interruption", "communication_style", "autonomy_control", "context_adaptation", "domain_priorities"]
  }
}
```

**Frontend receives:**
- No explicit confirmation (success is assumed if no error)
- If error occurs, an error message will be sent

**Field Descriptions:**

1. **`choice`** (required):
   - `"YES"`: User accepts the AI's suggestion
   - `"NO"`: User declines and wants different behavior

2. **`response`** (required):
   - If `choice` is `"YES"`: Set to `"N/A"`
   - If `choice` is `"NO"`: User's preferred response (what they would have wanted to hear)

3. **`satisfaction_survey`** (required):
   - Format: `"Q1:1-5 Q2:1-5 Q3:1-5 Q4:1-5 Q5:1-5"`
   - Q1: Relevance & Timing (1=irrelevant, 5=perfect timing)
   - Q2: Intrusiveness (1=disruptive, 5=seamlessly integrated)
   - Q3: Value (1=useless, 5=extremely helpful)
   - Q4: Appropriateness (1=inappropriate, 5=perfectly appropriate)
   - Q5: Comfort with Autonomy (1=too pushy, 5=respectful)

4. **`mark`** (required):
   - Category-specific behavioral guidance
   - Format: `"category_name: detailed feedback"` or `"NONE"`
   - Example: `"communication_style: I prefer casual, friendly communication. Be less formal."`
   - Can include multiple categories: `"category1: feedback1; category2: feedback2"`

5. **`category_ranking`** (required):
   - Array of 5 category names in priority order (highest to lowest)
   - Valid categories: `"communication_style"`, `"timing_interruption"`, `"autonomy_control"`, `"context_adaptation"`, `"domain_priorities"`

**Example Feedback Messages:**

**YES (Accept):**
```json
{
  "choice": "YES",
  "response": "N/A",
  "satisfaction_survey": "Q1:5 Q2:5 Q3:5 Q4:5 Q5:5",
  "mark": "NONE",
  "category_ranking": ["timing_interruption", "communication_style", "autonomy_control", "context_adaptation", "domain_priorities"]
}
```

**NO (Decline with feedback):**
```json
{
  "choice": "NO",
  "response": "I prefer a more casual tone, please be less formal.",
  "satisfaction_survey": "Q1:2 Q2:3 Q3:2 Q4:3 Q5:3",
  "mark": "communication_style: I prefer casual, friendly communication. Be less formal and more conversational.",
  "category_ranking": ["communication_style", "timing_interruption", "autonomy_control", "context_adaptation", "domain_priorities"]
}
```

**Notes:**
- After sending feedback, frontend can immediately send another context (Step 3) for the next interaction
- Feedback is used to update activation steering (for `activation_steering` and `combined` methods)
- Frontend should validate all required fields before sending

---

### Step 5: End Session

**Purpose**: Gracefully end the current session.

**Frontend sends:**
```json
{
  "type": "end"
}
```

**Frontend receives:**
- Connection may close, or no response (session ended)

**Notes:**
- Frontend should close WebSocket connection after sending end
- Session state is saved automatically, allowing resume later

---

## Error Handling

### Error Message Format

```json
{
  "type": "error",
  "code": "ERROR_CODE",
  "message": "Human-readable error message",
  "detail": "Additional error details (optional)"
}
```

### Common Error Codes

- `USER_NOT_FOUND`: User ID not found in session logs (resume failed)
- `INVALID_METHOD`: Method selection is invalid
- `INVALID_SESSION`: Session data is corrupted or invalid
- Connection errors: WebSocket connection lost (frontend should handle reconnection)

### Error Handling Strategy

1. **Display error message** to user
2. **For `USER_NOT_FOUND`**: Allow user to start new session
3. **For `INVALID_METHOD`**: Retry with valid method
4. **For connection errors**: Implement reconnection logic (backend auto-retries every 15s)

---

## State Management

### Frontend State Machine

```
disconnected → connected → hello_sent → method_sent → waiting_response → waiting_feedback → (loop back to method_sent)
```

**State Transitions:**
- `disconnected`: No WebSocket connection
- `connected`: WebSocket connected, waiting for hello
- `hello_sent`: Hello sent, waiting for confirmation
- `method_sent`: Method confirmed (or resume confirmed), ready for context
- `waiting_response`: Context sent, waiting for AI response
- `waiting_feedback`: Response received, waiting for user feedback

### Session Persistence

- Backend automatically saves session state after each interaction
- Frontend can resume sessions using `resume: true` in hello message
- Session data includes: method, interaction_count, dataset directory

---

## Complete Workflow Example

### New Session Flow

```javascript
// 1. Connect
const socket = new WebSocket('ws://bridge:8765/ui');

// 2. Send Hello
socket.send(JSON.stringify({
  type: "hello",
  user_id: "user_123"
}));

// Wait for hello_confirm

// 3. Send Method
socket.send(JSON.stringify({
  type: "method",
  method: "activation_steering"
}));

// Wait for method_confirm

// 4. Send Context
socket.send(JSON.stringify({
  type: "context",
  payload: {
    scenario_text: "Cooking dinner (timing_interruption)",
    timeframe: "2024-01-15 18:00 - 2024-01-15 19:30"
  }
}));

// Wait for response

// 5. Send Feedback
socket.send(JSON.stringify({
  type: "feedback",
  payload: {
    choice: "YES",
    response: "N/A",
    satisfaction_survey: "Q1:5 Q2:5 Q3:5 Q4:5 Q5:5",
    mark: "NONE",
    category_ranking: ["timing_interruption", "communication_style", "autonomy_control", "context_adaptation", "domain_priorities"]
  }
}));

// Repeat steps 4-5 for more interactions

// 6. End Session
socket.send(JSON.stringify({
  type: "end"
}));
```

### Resume Session Flow

```javascript
// 1. Connect
const socket = new WebSocket('ws://bridge:8765/ui');

// 2. Send Hello with Resume
socket.send(JSON.stringify({
  type: "hello",
  user_id: "user_123",
  resume: true
}));

// Wait for resume_confirm (includes method and interaction_count)

// 3. Continue from Step 4 (Send Context) - skip method selection
socket.send(JSON.stringify({
  type: "context",
  payload: {
    scenario_text: "Working on project (autonomy_control)",
    timeframe: "2024-01-15 14:00 - 2024-01-15 16:00"
  }
}));

// Continue with normal flow...
```

---

## Best Practices

### 1. Connection Management
- Implement automatic reconnection with exponential backoff
- Handle connection loss gracefully
- Show connection status to user

### 2. Message Validation
- Validate all required fields before sending
- Handle malformed JSON gracefully
- Display user-friendly error messages

### 3. User Experience
- Show loading states during AI response generation
- Display interaction count to user
- Allow user to cancel/resume sessions
- Save user feedback locally as backup

### 4. Error Recovery
- For resume failures, allow starting new session
- For invalid methods, show valid options
- For connection errors, attempt reconnection

### 5. Testing
- Test all three methods (vanilla, activation_steering, combined)
- Test resume functionality
- Test error scenarios
- Test with various feedback combinations

---

## Testing with Dashboard

A test dashboard is provided at `dashboard.html` for quick testing:

1. Open `dashboard.html` in a browser
2. Connect to bridge server
3. Use pre-filled buttons to test each workflow step
4. Monitor message log for debugging

---

## Deployment

See `DEPLOYMENT_GUIDE.md` for detailed deployment instructions, including:
- GitHub Pages + VPS setup (recommended)
- Same VPS deployment
- SSL/WSS configuration
- Environment variables setup

**Quick Note**: If deploying to GitHub Pages (HTTPS), you must use `wss://` (secure WebSocket) and configure SSL on your VPS bridge server.

## Support

For issues or questions:
- Check backend logs for detailed error messages
- Verify WebSocket bridge server is running
- Ensure model server is connected to bridge
- Review session logs in `./session_logs/` directory
- See `DEPLOYMENT_GUIDE.md` for deployment issues

---

## Appendix: Message Type Reference

### Frontend → Backend

| Type | Required Fields | Optional Fields | Description |
|------|----------------|-----------------|-------------|
| `hello` | `user_id` | `resume` (boolean or string) | Start new or resume session |
| `method` | `method` | - | Select interaction method |
| `context` | `payload.scenario_text`, `payload.timeframe` | - | Send context for interaction |
| `feedback` | `payload.choice`, `payload.response`, `payload.satisfaction_survey`, `payload.mark`, `payload.category_ranking` | - | Send user feedback |
| `end` | - | - | End session |

### Backend → Frontend

| Type | Fields | Description |
|------|--------|-------------|
| `hello_confirm` | `user_id`, `status` | Hello confirmed (new session) |
| `resume_confirm` | `user_id`, `method`, `interaction_count`, `status` | Resume confirmed |
| `method_confirm` | `method`, `status` | Method confirmed |
| `response` | `response`, `interaction_count` | AI-generated response |
| `error` | `code`, `message`, `detail?` | Error occurred |

---

**Last Updated**: 2025-11-20
**Version**: 1.1

## Changelog

### Version 1.1 (2025-11-20)
- Updated `resume` field to accept both boolean and string values for flexibility
- Backend now handles `resume` as boolean (`true`/`false`) or string (`"true"`, `"resume"`, `"1"`, `"yes"`)

