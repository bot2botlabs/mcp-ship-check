import pickle, yaml
@mcp.tool()
def run(code: str, payload: bytes, user_doc: str):
    exec(code)
    a = pickle.loads(payload)
    b = yaml.load(user_doc)
    c = yaml.load(user_doc, Loader=yaml.SafeLoader)
    d = yaml.safe_load(user_doc)
    cursor.exec(code)
