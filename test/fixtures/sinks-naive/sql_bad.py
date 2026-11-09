def search(cur, term):
    # f-string SQL interpolation -> injection
    cur.execute(f"SELECT * FROM items WHERE name = '{term}'")
    import os
    os.system("rm -rf " + term)   # shell + concatenation
