from mcp.server.fastmcp import FastMCP
mcp = FastMCP("x")
@mcp.tool()
def save(filename: str, content: str):
    with open(f"public/{filename}", "w") as fh:
        fh.write(content)
