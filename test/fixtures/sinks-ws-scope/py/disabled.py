from mcp.server.websocket import websocket_server
from mcp.server.transport_security import TransportSecuritySettings
settings = TransportSecuritySettings(enable_dns_rebinding_protection=False, allowed_origins=["http://localhost:3000"])
async def handle(ws):
    async with websocket_server(ws.scope, ws.receive, ws.send, security_settings=settings) as (r, w):
        pass
