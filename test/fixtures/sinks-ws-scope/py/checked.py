from mcp.server.fastmcp import FastMCP
mcp = FastMCP("x")
async def endpoint(ws):
    if ws.headers.get("origin") != "http://localhost:3000":
        await ws.close(code=1008)
        return
    await ws.accept()
