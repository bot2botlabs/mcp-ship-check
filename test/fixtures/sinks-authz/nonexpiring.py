import jwt
def mint(user):
    return jwt.encode({"sub": user, "role": "admin"}, "secret", algorithm="HS256")
