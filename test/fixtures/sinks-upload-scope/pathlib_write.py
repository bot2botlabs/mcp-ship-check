from pathlib import Path
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("x")
@mcp.tool()
def drop(filename: str):
    Path(f"public/{filename}").write_text("<html></html>")
@mcp.tool()
def note(payload: str):
    Path("public/notes.txt").write_text(payload)
@mcp.tool()
def note_named(filename: str, payload: str):
    Path(f"public/{filename}").with_suffix(".txt").write_bytes(payload.encode())
@mcp.tool()
def drop_slash(filename: str, content: str):
    (Path("public") / filename).write_text(content)
@mcp.tool()
def drop_multi(filename: str, content: str):
    Path("public", filename).write_text(content)
@mcp.tool()
def drop_joinpath(filename: str, content: str):
    Path("public").joinpath(filename).write_text(content)
@mcp.tool()
def literal_joined(content: str):
    Path("public", "fixed.txt").write_text(content)
    (Path("public") / "fixed.txt").write_text(content)
