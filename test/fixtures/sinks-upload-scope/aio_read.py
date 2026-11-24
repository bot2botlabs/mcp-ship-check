import aiofiles
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("x")
@mcp.tool()
async def show(filename: str):
    async with aiofiles.open(f"public/{filename}", "r") as fh:
        return await fh.read()
@mcp.tool()
def show_kw(filename: str):
    with open(f"public/{filename}", encoding="utf-8", mode="rb") as fh:
        return fh.read()
