def q(cur, table, cols, term):
    cur.execute(f"SELECT * FROM {table}")
    cur.execute(f"SELECT {cols} FROM {table}")
    cur.execute(f"SELECT * FROM {table} WHERE name = '{term}'")
    cur.execute(f"SELECT * FROM {table} WHERE id = {term}")
    cur.execute(f"DELETE FROM {table}")
