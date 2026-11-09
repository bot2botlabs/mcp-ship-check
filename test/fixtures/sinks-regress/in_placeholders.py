def by_ids(conn, ids):
    placeholders = ",".join("?" for _ in ids)
    return conn.execute(f"DELETE FROM memory_embeddings WHERE id IN ({placeholders})", tuple(ids)).fetchall()
