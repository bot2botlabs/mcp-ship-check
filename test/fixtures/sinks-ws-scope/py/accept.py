from mcp.server.fastmcp import FastMCP
mcp = FastMCP("x")
async def endpoint(ws):
    await ws.accept()
    await mcp.run_socket(ws)
