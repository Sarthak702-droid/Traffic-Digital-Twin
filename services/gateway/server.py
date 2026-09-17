"""Bounded stdlib HTTP gateway and WebSocket tunnel for the local digital twin.

Run behind a TLS terminator for shared deployment. Private listeners and signed
user sessions are separate from domain/writer credentials. No database driver.
"""
import base64
import hashlib
import hmac
import http.client
import json
import os
import re
import secrets
import select
import socket
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from services.gateway.routes import resolve

MAX_BODY = 1024 * 1024
DOMAIN_TOKEN = os.environ.get('DOMAIN_TOKEN', '')
WRITE_TOKEN = os.environ.get('DOMAIN_WRITE_TOKEN', '')
WRITER_TOKEN = os.environ.get('WRITER_TOKEN', '')
SESSION_SECRET = os.environ.get('SESSION_SECRET', '')
WRITER = os.environ.get('WRITER_ORIGIN', 'http://127.0.0.1:8083')
DOMAINS = os.environ.get('DOMAIN_ORIGINS', 'http://127.0.0.1:8081').split(',')
PUBLIC_ORIGIN = os.environ.get('UI_ORIGIN', 'http://127.0.0.1:3100')
PRODUCTION = os.environ.get('APP_ENV') == 'production'
SESSION_TTL = 3600
public_slots = threading.BoundedSemaphore(64)
private_slots = threading.BoundedSemaphore(32)
stream_slots = threading.BoundedSemaphore(32)
login_lock = threading.Lock()
login_attempts = {}

def encode(data): return json.dumps(data, separators=(',', ':')).encode()
def upstream(origin, method, path, body=None, headers=None, timeout=6):
    parsed = urlsplit(origin)
    cls = http.client.HTTPSConnection if parsed.scheme == 'https' else http.client.HTTPConnection
    connection = cls(parsed.hostname, parsed.port, timeout=timeout)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        result = connection.getresponse()
        data = result.read(4 * MAX_BODY + 1)
        if len(data) > 4 * MAX_BODY: raise ValueError('Response exceeds limit')
        return result.status, data
    finally: connection.close()

def write(operation, payload, actor='gateway'):
    code, body = upstream(WRITER, 'POST', '/internal/write', encode({'operation': operation, 'payload': payload, 'actor': actor}), {'Content-Type': 'application/json', 'X-Service-Token': WRITER_TOKEN}, 5)
    if code != 200: raise OSError('Writer unavailable')
    return json.loads(body)

def users():
    path = os.environ.get('GATEWAY_USERS_FILE', '')
    if not path: return {}
    with open(path) as source: return json.load(source)

def signed_session(actor, role, version):
    payload = base64.urlsafe_b64encode(encode({'actor': actor, 'role': role, 'exp': int(time.time()) + SESSION_TTL, 'version': version})).decode()
    return payload + '.' + hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()

def principal(cookie):
    try:
        jar = SimpleCookie(); jar.load(cookie)
        payload, signature = jar['twin_session'].value.split('.')
        if not hmac.compare_digest(signature, hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()): return None
        value = json.loads(base64.urlsafe_b64decode(payload))
        account = users().get(value['actor'])
        if value['exp'] <= time.time() or not account or account.get('disabled') or value['version'] != account.get('version', 1) or value['role'] != account['role']: return None
        return value
    except (KeyError, ValueError, TypeError, OSError): return None

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_): pass  # No passwords, bodies or tokens in access logs.
    def reply(self, code, value, headers=None):
        data = encode(value)
        self.send_response(code)
        for key, val in {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': str(len(data)), 'X-Request-ID': getattr(self, 'request_id', '') , **(headers or {})}.items(): self.send_header(key, val)
        self.end_headers(); self.wfile.write(data)
    def error(self, code, message, command_id=None, uncertain=False):
        # Rejected requests can still have an unread body; never parse it as a new request.
        self.close_connection = True
        self.reply(code, {'message': message, 'code': str(code), 'request_id': self.request_id, 'command_id': command_id, 'outcome': 'unknown' if uncertain else 'not_dispatched'})
    def do_GET(self): self.handle_request()
    def do_POST(self): self.handle_request()
    def do_DELETE(self): self.handle_request()
    def do_PUT(self): self.handle_request()
    def do_PATCH(self): self.handle_request()
    def handle_request(self):
        self.request_id = secrets.token_hex(16)
        self.connection.settimeout(10)
        # Streams must not consume capacity needed for durable writer acknowledgments.
        slots = private_slots if self.server.private else stream_slots if urlsplit(self.path).path == '/ws/v1/live' else public_slots
        if not slots.acquire(False):
            self.close_connection = True
            self.error(429, 'Gateway busy; retry reads later'); return
        try: self.dispatch()
        except (OSError, ValueError, http.client.HTTPException, json.JSONDecodeError):
            self.close_connection = True
            self.error(503, 'Dependency unavailable or invalid response; retry reads or inspect command status')
        finally: slots.release()
    def body(self):
        if self.headers.get('Transfer-Encoding'): raise ValueError('Chunked commands not supported')
        n = int(self.headers.get('Content-Length', '0'))
        if n < 0 or n > MAX_BODY: raise ValueError('Command exceeds limit')
        data = self.rfile.read(n)
        if len(data) != n: raise ValueError('Incomplete command body')
        return data
    def dispatch(self):
        path = urlsplit(self.path).path
        if self.server.private:
            if not hmac.compare_digest(self.headers.get('X-Service-Token', ''), WRITE_TOKEN): self.error(401, 'Private gateway'); return
            if self.command != 'POST' or path != '/internal/write': self.error(404, 'Unknown private route'); return
            envelope = json.loads(self.body())
            if not isinstance(envelope, dict) or not all(k in envelope for k in ('operation', 'payload', 'actor')):
                self.error(400, 'Invalid write envelope'); return
            result = write(envelope['operation'], envelope['payload'], envelope['actor'])
            self.reply(200, result); return
        if self.command != 'GET' and self.headers.get('Origin') != PUBLIC_ORIGIN:
            self.error(403, 'Same-origin command required'); return
        if path == '/api/v1/session/login' and self.command == 'POST':
            key = self.client_address[0]
            with login_lock:
                now=time.monotonic(); attempts=[t for t in login_attempts.get(key,[]) if now-t<60]
                if len(attempts)>=10: self.error(429,'Too many sign-in attempts; wait one minute');return
                login_attempts[key]=attempts+[now]
            data=json.loads(self.body())
            if not isinstance(data, dict): self.error(400,'Credentials must be an object');return
            actor=data.get('username',''); password=data.get('password','')
            if not isinstance(actor,str) or not isinstance(password,str) or len(password)>1024: self.error(400,'Invalid credentials');return
            account=users().get(actor)
            salt=account.get('salt','') if account else 'unknown-user'
            digest=hashlib.pbkdf2_hmac('sha256',password.encode(),salt.encode(),600000).hex()
            if not account or account.get('disabled') or not hmac.compare_digest(digest,account['hash']): self.error(401,'Sign-in failed');return
            token=signed_session(actor,account['role'],account.get('version',1))
            self.reply(200,{'actor':actor,'role':account['role']},{'Set-Cookie':f'twin_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TTL}'+('; Secure' if PRODUCTION else '')});return
        if path == '/api/v1/session/logout' and self.command == 'POST':
            self.body();self.reply(200,{'signed_out':True},{'Set-Cookie':'twin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});return
        identity=principal(self.headers.get('Cookie',''))
        if identity is None: self.error(401,'Session expired or sign-in required. Your unsent draft is retained.');return
        if path == '/api/v1/session' and self.command == 'GET': self.reply(200,{'actor':identity['actor'],'role':identity['role']});return
        if re.fullmatch(r'/api/v1/commands/[A-Za-z0-9-]{8,128}',path) and self.command=='GET':
            outcome=write('command.get',{'id':path.rsplit('/',1)[1]},identity['actor'])
            self.reply(403 if outcome.get('status')=='conflict' else 200,outcome);return
        route=resolve(self.command,path)
        if not route:
            known=any(resolve(m,path) for m in ('GET','POST','DELETE'))
            self.error(405 if known else 404,'Unknown method or route');return
        owner,durable=route
        if durable and identity['role']=='viewer': self.error(403,'Viewer has read-only access');return
        if os.environ.get('MAINTENANCE')=='1' and durable: self.error(503,'Maintenance: mutations temporarily unavailable');return
        lease=write('lease',{})
        origin=lease.get('owner')
        if not lease.get('valid') or origin not in DOMAINS: self.error(503,'No active run owner; recovery required');return
        headers={'X-Service-Token':DOMAIN_TOKEN,'X-Actor':identity['actor'],'X-Role':identity['role'],'X-Request-ID':self.request_id,'Content-Type':'application/json'}
        if owner=='stream':
            if self.headers.get('Origin')!=PUBLIC_ORIGIN: self.error(403,'WebSocket origin denied');return
            self.tunnel(origin,headers,identity['exp']);return
        body=self.body() if durable else None
        command_id=None;digest=None
        if durable:
            command_id=self.headers.get('Idempotency-Key','')
            if not re.fullmatch(r'[A-Za-z0-9-]{8,128}',command_id): self.error(400,'Idempotency-Key is required');return
            try: payload=json.loads(body or b'{}')
            except ValueError: self.error(400,'Invalid JSON command');return
            digest=hashlib.sha256(json.dumps([self.command,path,payload],sort_keys=True,separators=(',', ':')).encode()).hexdigest()
            reservation=write('command.reserve',{'id':command_id,'hash':digest},identity['actor'])
            if reservation['status']!='reserved':
                if reservation['status']=='completed':self.reply(reservation['http_status'],reservation['response'],{'X-Command-ID':command_id})
                elif reservation['status']=='conflict':self.error(409,'Idempotency key belongs to different content or actor',command_id,False)
                else:self.error(409,'Command already pending, uncertain, or reused with different content; inspect command status',command_id,True)
                return
            headers['X-Command-ID']=command_id
        try:
            status,data=upstream(origin,self.command,self.path,body,headers,8)
            result=json.loads(data)
            if durable:
                write('command.finish',{'id':command_id,'hash':digest,'http_status':status,'response':result,'unknown':status>=500},identity['actor'])
            self.reply(status,result,{'X-Command-ID':command_id or ''})
        except (OSError,ValueError,http.client.HTTPException):
            if durable:
                try:write('command.finish',{'id':command_id,'hash':digest,'http_status':503,'response':{'message':'Command outcome unknown'},'unknown':True},identity['actor'])
                except OSError:pass
            self.error(503,'Command outcome unknown; inspect saved command before any new submission' if durable else 'Domain unavailable; retry read',command_id,bool(durable))
    def tunnel(self, origin, headers, expiry):
        parsed=urlsplit(origin)
        upstream_socket=socket.create_connection((parsed.hostname,parsed.port),3)
        try:
            forwarded={**headers,'Host':parsed.netloc,'Connection':'Upgrade','Upgrade':'websocket','Origin':PUBLIC_ORIGIN,'Sec-WebSocket-Version':'13','Sec-WebSocket-Key':self.headers.get('Sec-WebSocket-Key','')}
            upstream_socket.sendall(('GET /ws/v1/live HTTP/1.1\r\n'+''.join(f'{k}: {v}\r\n' for k,v in forwarded.items())+'\r\n').encode())
            # Forward the HTTP handshake and frames unchanged. No unbounded queue.
            self.close_connection=True
            while time.time()<expiry:
                ready,_,_=select.select([self.connection,upstream_socket],[],[],1)
                for source in ready:
                    data=source.recv(65536)
                    if not data:return
                    target=upstream_socket if source is self.connection else self.connection
                    target.sendall(data)
        finally:upstream_socket.close()

def serve():
    if any(len(v)<32 for v in (DOMAIN_TOKEN,WRITE_TOKEN,WRITER_TOKEN,SESSION_SECRET)):raise RuntimeError('Independent service/session secrets of 32+ characters required')
    if not users():raise RuntimeError('GATEWAY_USERS_FILE with provisioned password hashes required')
    host=os.environ.get('GATEWAY_HOST','127.0.0.1')
    public=ThreadingHTTPServer((host,int(os.environ.get('GATEWAY_PORT','8080'))),Handler);public.private=False;public.daemon_threads=True
    private=ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('GATEWAY_INTERNAL_PORT','8082'))),Handler);private.private=True;private.daemon_threads=True
    threading.Thread(target=private.serve_forever,daemon=True).start()
    try:public.serve_forever()
    finally:private.shutdown();public.server_close();private.server_close()
if __name__=='__main__':serve()
