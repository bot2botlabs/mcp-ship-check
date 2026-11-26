import os
def check(token):
    if token == os.environ["API_TOKEN"]:   # non-constant-time -> flag
        return True
    return False
