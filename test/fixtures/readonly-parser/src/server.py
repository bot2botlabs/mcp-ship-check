import duckdb
import sqlglot

def run(sql: str):
    tree = sqlglot.parse_one(sql)
    if tree.key != "select":
        raise ValueError("read-only")
    return duckdb.sql(sql).fetchall()
