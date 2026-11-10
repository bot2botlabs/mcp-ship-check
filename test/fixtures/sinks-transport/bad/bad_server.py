from mcp.server.fastmcp import FastMCP
import uvicorn
mcp = FastMCP("demo")
app = mcp.streamable_http_app()
uvicorn.run(app, host="0.0.0.0", port=3000)
