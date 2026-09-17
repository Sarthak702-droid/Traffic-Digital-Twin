"""Local durable simulator receipts, separate from business persistence in Go.

A process restart never silently replays an actuation. Prepared receipts are
uncertain in the same process and interrupted after restart; accepted receipts
prove scheduling acceptance, not physical signal control or boundary completion.
"""
import hashlib
import sqlite3
import uuid

class Receipts:
    def __init__(self, path):
        self.boot = uuid.uuid4().hex
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, boot TEXT NOT NULL, status TEXT NOT NULL)')
        self.db.commit()

    def digest(self, command):
        return hashlib.sha256(command.SerializeToString(deterministic=True)).hexdigest()

    def status(self, command):
        row = self.db.execute('SELECT hash, boot, status FROM receipts WHERE id=?', (command.command_id,)).fetchone()
        if row is None: return 'not_found'
        if row[0] != self.digest(command): return 'conflict'
        if row[2] == 'prepared': return 'unknown' if row[1] == self.boot else 'interrupted'
        return row[2]

    def prepare(self, command):
        self.db.execute('INSERT INTO receipts VALUES(?,?,?,?)', (command.command_id, self.digest(command), self.boot, 'prepared'))
        self.db.commit()

    def accept(self, command):
        self.db.execute("UPDATE receipts SET status='accepted' WHERE id=?", (command.command_id,))
        self.db.commit()
