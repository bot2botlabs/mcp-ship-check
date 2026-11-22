import duckdb

def rows(con: duckdb.DuckDBPyConnection, symbol: str):
    return con.execute("SELECT * FROM quotes WHERE symbol = ?", [symbol]).fetchall()
