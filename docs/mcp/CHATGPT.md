# Connect MBrain to ChatGPT

**Status: Coming Soon**

ChatGPT requires OAuth 2.1 with Dynamic Client Registration for MCP connectors. Bearer token authentication is not supported by ChatGPT's MCP integration.

This is tracked as a P0 priority for MBrain v0.7.

## What's needed

- OAuth 2.1 authorization endpoint on the Edge Function
- Token endpoint with PKCE flow
- Dynamic Client Registration support
- ChatGPT Developer Mode (available on Pro/Team/Enterprise/Edu plans)

## Workaround

Until OAuth support ships, you can use MBrain with ChatGPT via a bridge:

1. Run `mbrain serve` locally
2. Use a tool like [mcp-remote](https://github.com/nichochar/mcp-remote) to bridge stdio to HTTP with OAuth support

## Timeline

Follow the [repository issue tracker](https://github.com/meghendra6/mbrain/issues) for updates on ChatGPT OAuth support.
