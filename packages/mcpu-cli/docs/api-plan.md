# MCPU Daemon API Design Plan

## Overview

This document outlines the RESTful API design for the MCPU daemon, transitioning from the current ad-hoc endpoints to a well-structured REST API.

## Resource Hierarchy

```
Daemon (singleton)
  └── Servers (configured MCP servers from config file)
        └── Connections (active runtime connections)
```

## Design Principles

### 1. RESTful Resource Model
- **Resources**: Daemon, Servers, Connections
- **Standard HTTP verbs**: GET (read), POST (create), DELETE (remove)
- **Custom actions**: Use `_verb` suffix (e.g., `/api/daemon/_shutdown`) - Express router doesn't support `:` in paths

### 2. Idempotency
- `POST /api/servers/{server}/connections` is idempotent
- Returns existing connection (200 OK) if already connected
- Returns new connection (201 Created) if creating new

### 3. Connection Identity
- **Connection IDs**: Simple integers (1, 2, 3...)
- **Global counter**: IDs increment across all servers
- **Reset on restart**: Counter resets to 1 when daemon restarts
- **One connection per server**: Current limitation maintained

### 4. Resource Nesting
- Connections nested under servers: `/api/servers/{server}/connections`
- Global view available: `/api/connections`
- Allows both server-scoped and global operations

### 5. Envelope Pattern (CRITICAL DESIGN DECISION)
All API responses use a consistent envelope pattern combining Option C (envelope) with Option A (full resources):

```json
{
  "success": boolean,        // true for success, false for errors
  "data": any,               // resource(s) or null for errors
  "error": object | null,    // error details or null for success
  "meta": object             // optional metadata
}
```

Benefits:
- **Consistent structure** across all endpoints
- **Full resource state** returned (including DELETE operations)
- **Clear success/failure** without checking HTTP status
- **Extensible** with meta, warnings, pagination
- **Better for SDKs** with single response parser

## API Endpoints Summary

### Daemon Management
- `GET /api/daemon` - Get daemon status (pid, port, uptime)
- `POST /api/daemon/_shutdown` - Gracefully shutdown daemon

### Server Management
- `GET /api/servers` - List all configured servers
- `GET /api/servers/{server}` - Get server configuration

### Connection Management (Server-scoped)
- `GET /api/servers/{server}/connections` - List connections for server
- `POST /api/servers/{server}/connections` - Create connection (idempotent)
- `GET /api/servers/{server}/connections/{id}` - Get specific connection
- `DELETE /api/servers/{server}/connections/{id}` - Close connection

### Connection Management (Global)
- `GET /api/connections` - List ALL active connections
- `GET /api/connections/{id}` - Get connection by ID
- `DELETE /api/connections/{id}` - Close connection by ID

### Tool Discovery & Execution
- `GET /api/servers/{server}/tools` - List available tools from server
- `GET /api/servers/{server}/tools/{tool}` - Get tool schema and details
- `POST /api/servers/{server}/tools/{tool}/_execute` - Execute a tool

### Legacy Endpoints (Deprecated)
- `POST /cli` - Execute CLI command
- `GET /health` - Health check
- `POST /exit` - Shutdown
- `POST /control` - Connection control

## Migration Strategy

### Phase 1: Parallel APIs
1. Implement new RESTful endpoints
2. Keep legacy endpoints functional
3. Mark legacy endpoints as deprecated in docs

### Phase 2: Client Migration
1. Update `mcpu-remote` to use new endpoints
2. Add fallback to legacy endpoints for older daemons
3. Document migration for external clients

### Phase 3: Legacy Removal (Future)
1. After sufficient migration period
2. Remove legacy endpoints in major version update
3. Simplify codebase

## Implementation Checklist

### Backend Changes

#### ConnectionPool Updates
- [ ] Add integer ID generation (global counter)
- [ ] Update data structures to track connection IDs
- [ ] Maintain server name → connection mapping
- [ ] Add ID → connection reverse mapping

#### Server Routes
- [ ] Implement `/api/daemon` endpoints
- [ ] Implement `/api/servers` endpoints
- [ ] Implement `/api/servers/{server}/connections` endpoints
- [ ] Implement `/api/connections` global endpoints
- [ ] Ensure legacy endpoints continue working

### Client Changes

#### mcpu-remote Updates
- [ ] Add support for new RESTful endpoints
- [ ] Detect daemon version and use appropriate API
- [ ] Update control commands to use new endpoints
- [ ] Maintain backward compatibility

### Documentation
- [x] Create OpenAPI 3.0 specification (`daemon-api.yaml`)
- [x] Create this design plan document
- [ ] Update README with new API examples
- [ ] Document migration guide for clients

### OpenAPI Spec Updates Status
#### Completed (with envelope pattern):
- [x] GET /api/daemon
- [x] POST /api/daemon/_shutdown
- [x] GET /api/servers
- [x] GET /api/servers/{server}
- [x] GET /api/servers/{server}/connections
- [x] POST /api/servers/{server}/connections
- [x] GET /api/servers/{server}/connections/{id}
- [x] DELETE /api/servers/{server}/connections/{id}
- [x] GET /api/servers/{server}/tools
- [x] GET /api/servers/{server}/tools/{tool}
- [x] POST /api/servers/{server}/tools/{tool}/_execute
- [x] GET /api/connections
- [x] GET /api/connections/{id}
- [x] DELETE /api/connections/{id}
- [x] Legacy endpoints (kept old format for compatibility)

## Response Formats (With Envelope Pattern)

### Successful GET Response
```json
{
  "success": true,
  "data": {
    "id": 1,
    "server": "playwright",
    "status": "connected",
    "connectedAt": 1700000000000,
    "lastUsed": 1700000000000,
    "closedAt": null
  },
  "error": null,
  "meta": {
    "timestamp": 1700000000000
  }
}
```

### Successful LIST Response
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "server": "playwright",
      "status": "connected",
      "connectedAt": 1700000000000,
      "lastUsed": 1700000000000,
      "closedAt": null
    }
  ],
  "error": null,
  "meta": {
    "count": 1,
    "timestamp": 1700000000000
  }
}
```

### Successful DELETE Response (Returns Deleted Resource)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "server": "playwright",
    "status": "disconnected",
    "connectedAt": 1700000000000,
    "lastUsed": 1700000000000,
    "closedAt": 1700000001000  // When it was closed
  },
  "error": null
}
```

### Successful Action Response
```json
{
  "success": true,
  "data": {
    "pid": 12345,
    "port": 7839,
    "uptime": 3600.5,
    "status": "shutting_down",
    "shutdownAt": 1700000001000
  },
  "error": null
}
```

### Error Response
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "SERVER_NOT_FOUND",
    "message": "Server 'invalid' not found in configuration",
    "details": {
      "server": "invalid",
      "availableServers": ["playwright", "browserbase"]
    }
  },
  "meta": {
    "timestamp": 1700000000000,
    "requestId": "req_abc123"
  }
}
```

### Tool Execution Response
```json
{
  "success": true,
  "data": {
    "tool": "browser_navigate",
    "server": "playwright",
    "executedAt": 1700000000000,
    "result": {
      "pageTitle": "Example Domain",
      "pageUrl": "https://example.com/",
      "snapshotPath": "/tmp/playwright-mcp-output/1700000000000/navigate.yaml"
    }
  },
  "error": null
}
```

## Error Code Conventions

### Standard Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| **Resource Errors** |
| `SERVER_NOT_FOUND` | 404 | Server not found in configuration |
| `CONNECTION_NOT_FOUND` | 404 | Connection ID doesn't exist |
| `TOOL_NOT_FOUND` | 404 | Tool not available on server |
| **Connection Errors** |
| `NOT_CONNECTED` | 503 | Server not connected |
| `CONNECTION_FAILED` | 500 | Failed to establish connection |
| `CONNECTION_LOST` | 500 | Lost connection to server |
| **Validation Errors** |
| `INVALID_PARAMS` | 400 | Invalid request parameters |
| `MISSING_FIELD` | 400 | Required field missing |
| `INVALID_FORMAT` | 400 | Invalid data format |
| **Execution Errors** |
| `TOOL_EXECUTION_FAILED` | 500 | Tool execution failed |
| `DAEMON_ERROR` | 500 | Internal daemon error |
| `TIMEOUT` | 504 | Operation timed out |

### Error Response Structure
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable error message",
    "details": {
      // Additional context
    }
  }
}
```

## Benefits of New Design

1. **Clarity**: Clear resource hierarchy and relationships
2. **Standards**: Follows REST conventions
3. **Discoverability**: Resources and operations are predictable
4. **Extensibility**: Easy to add new resources and operations
5. **Tooling**: Works with standard REST clients and tools
6. **Documentation**: OpenAPI spec enables auto-generated docs and clients

## Future Enhancements

### Multiple Connections per Server
- Change connection IDs to `{server}-{n}` format
- Update pool to support multiple connections
- Use cases: load balancing, redundancy

### Connection Pooling Features
- Connection health checks
- Auto-reconnect on failure
- Connection metrics and statistics
- Connection limits and throttling


### WebSocket Support
- Real-time connection status updates
- Streaming tool execution results
- Server event notifications

## Testing Strategy

### Unit Tests
- Connection ID generation
- Pool management logic
- Route handlers

### Integration Tests
- Full API workflow tests
- Legacy endpoint compatibility
- Error handling scenarios

### Load Tests
- Multiple concurrent connections
- Connection pool limits
- Memory leak detection

## Security Considerations

### Authentication (Future)
- API key authentication
- JWT tokens for session management
- Rate limiting per client

### Authorization (Future)
- Server-level permissions
- Tool execution permissions
- Admin vs user roles

### Network Security
- Currently localhost only
- Future: TLS support for remote access
- Firewall considerations

## Conclusion

This RESTful API design provides a clean, scalable foundation for the MCPU daemon. The migration strategy ensures backward compatibility while moving toward a more maintainable architecture.