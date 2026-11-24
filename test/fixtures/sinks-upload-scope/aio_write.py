import aiofiles
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("x")
@mcp.tool()
async def save(filename: str, content: str):
    async with aiofiles.open(f"public/{filename}", "w") as fh:
        await fh.write(content)
@mcp.tool()
def save_kw(filename: str, content: str):
    with open(f"public/{filename}", encoding="utf-8", mode="w") as fh:
        fh.write(content)
