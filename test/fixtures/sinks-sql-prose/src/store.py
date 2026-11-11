# Python f-strings: two real SQL shapes and one status message.
def drop(conn, name, table):
    conn.execute(f'DROP TABLE "{name}"')
    conn.execute(f"TRUNCATE TABLE {table}")
    return f"Current update set changed to '{name}'"
