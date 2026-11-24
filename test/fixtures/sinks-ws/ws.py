from mcp.server.websocket import websocket_server
from mcp.server import Server
app = Server("x")
async def handle(ws):
    async with websocket_server(ws.scope, ws.receive, ws.send) as (r, w):
        await app.run(r, w, app.create_initialization_options())
