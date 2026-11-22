import requests, ipaddress, socket
def is_private(host):
    return ipaddress.ip_address(socket.gethostbyname(host)).is_private
@mcp.tool()
def fetch_page(url: str) -> str:
    if is_private(url): raise ValueError('refused')
    return requests.get(url, timeout=10).text
