import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
export function newTransport() {
  return new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
}
