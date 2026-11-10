from mcp.server.fastmcp import FastMCP
import uvicorn
mcp = FastMCP("demo")
app = mcp.streamable_http_app()
uvicorn.run(app, host="127.0.0.1", port=3000)
