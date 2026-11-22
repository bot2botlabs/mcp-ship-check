def is_local(client_host: str) -> bool:
    return "127.0.0.1" in client_host or "::1" in client_host
