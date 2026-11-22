import Fastify from 'fastify';
import cors from '@fastify/cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
const fastify = Fastify();
fastify.register(cors, { origin: true });
fastify.post('/mcp', async (request, reply) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await transport.handleRequest(request.raw, reply.raw, request.body);
});
await fastify.listen({ port: 3000, host: '127.0.0.1' });
