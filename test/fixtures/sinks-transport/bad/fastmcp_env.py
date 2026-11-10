import os
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("demo", host=os.getenv("HTTP_HOST", "0.0.0.0"), port=8000)
if __name__ == "__main__":
    mcp.run(transport="streamable-http")
