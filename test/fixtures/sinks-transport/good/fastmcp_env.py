import os
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("demo", host=os.environ.get("HTTP_HOST", "127.0.0.1"), port=8000)
mcp.run(transport="streamable-http")
