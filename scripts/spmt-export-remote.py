# Runs on the SPMT Fly machine. Copies ONLY the chosen tables into a small file.
# Source is opened read-only. Oauth refresh/codes/secret tables are never copied.
import sqlite3, os, sys
TABLES = ["xp_ledger", "users", "workspace_profiles", "user_settings", "app_state_records"]
src = sqlite3.connect("file:/data/spmt.db?mode=ro", uri=True)
dst_path = "/tmp/spmt-xp-export.db"
if os.path.exists(dst_path):
    os.remove(dst_path)
dst = sqlite3.connect(dst_path)
for t in TABLES:
    cols = [r[1] for r in src.execute(f'PRAGMA table_info("{t}")').fetchall()]
    if not cols:
        print(f"MISSING {t}", file=sys.stderr)
        continue
    dst.execute(f'CREATE TABLE "{t}" ({", ".join(chr(34)+c+chr(34) for c in cols)})')
    rows = src.execute(f'SELECT {", ".join(chr(34)+c+chr(34) for c in cols)} FROM "{t}"')
    ph = ",".join("?" * len(cols))
    n = 0
    while True:
        batch = rows.fetchmany(5000)
        if not batch:
            break
        dst.executemany(f'INSERT INTO "{t}" VALUES ({ph})', batch)
        n += len(batch)
    dst.commit()
    print(f"{t}\t{n}")
dst.close()
print("EXPORT_BYTES", os.path.getsize(dst_path))
