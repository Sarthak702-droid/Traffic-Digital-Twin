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
        self.db.execute('CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, boot TEXT NOT NULL, status TEXT NOT NULL, applied_tick INTEGER, message TEXT)')
        columns={row[1] for row in self.db.execute('PRAGMA table_info(receipts)')}
        if 'applied_tick' not in columns:self.db.execute('ALTER TABLE receipts ADD COLUMN applied_tick INTEGER')
        if 'message' not in columns:self.db.execute('ALTER TABLE receipts ADD COLUMN message TEXT')
        self.db.commit()

    def digest(self, command):
        return hashlib.sha256(command.SerializeToString(deterministic=True)).hexdigest()

    def status(self, command):
        row = self.db.execute('SELECT hash, boot, status FROM receipts WHERE id=?', (command.command_id,)).fetchone()
        if row is None: return 'not_found'
        if row[0] != self.digest(command): return 'conflict'
        if row[2] == 'prepared': return 'unknown' if row[1] == self.boot else 'interrupted'
        if row[2] == 'accepted' and row[1] != self.boot:return 'interrupted'
        return row[2]

    def prepare(self, command):
        self.db.execute('INSERT INTO receipts(id,hash,boot,status) VALUES(?,?,?,?)', (command.command_id, self.digest(command), self.boot, 'prepared'))
        self.db.commit()

    def accept(self, command):
        self.db.execute("UPDATE receipts SET status='accepted' WHERE id=?", (command.command_id,))
        self.db.commit()

    def finish(self, command, status, applied_tick=None, message=None):
        if status not in ('applied', 'rejected') or self.status(command) != 'accepted':
            raise ValueError('Only an accepted plan can reach a terminal outcome')
        self.db.execute('UPDATE receipts SET status=?, applied_tick=?, message=? WHERE id=?', (status, applied_tick, message, command.command_id))
        self.db.commit()

    def applied_at(self, command):
        if self.status(command) != 'applied':return None
        return self.db.execute('SELECT applied_tick FROM receipts WHERE id=?', (command.command_id,)).fetchone()[0]

    def message(self, command):
        if self.status(command) in ('not_found', 'conflict'):return None
        return self.db.execute('SELECT message FROM receipts WHERE id=?', (command.command_id,)).fetchone()[0]
