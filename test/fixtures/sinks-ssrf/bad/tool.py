import requests, httpx
@mcp.tool()
def fetch_page(url: str) -> str:
    return requests.get(url, timeout=10).text
@mcp.tool()
def probe(args: dict) -> str:
    return httpx.get(f"{args['host']}/health").text
