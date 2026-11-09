"""Istanbul-style guarded query: parameterized, no interpolation."""
import sqlite3

def lookup(conn: sqlite3.Connection, stop_id: str):
    # Placeholders, values passed separately. Never an f-string.
    return conn.execute(
        "SELECT * FROM records WHERE stop_id = ? AND active = 1",
        (stop_id,),
    ).fetchall()

def run_cmd(cwd, ref):
    import subprocess
    # list argument, shell defaults to False
    return subprocess.run(["git", "-C", cwd, "rev-parse", ref], capture_output=True)
