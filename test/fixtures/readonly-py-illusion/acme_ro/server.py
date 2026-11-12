import psycopg

READ_ONLY = True
FORBIDDEN = ("INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE")

def run(conn: psycopg.Connection, sql: str):
    s = sql.strip().upper()
    if READ_ONLY and (not s.startswith(("SELECT", "WITH")) or any(w in s for w in FORBIDDEN)):
        raise ValueError("write blocked")
    return conn.execute(sql).fetchall()
