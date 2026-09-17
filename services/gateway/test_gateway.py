"""Protocol unit checks; these do not replace full-stack or failover acceptance."""
import io
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from services.gateway import server
from services.gateway.routes import resolve

class GatewayTests(unittest.TestCase):
    def handler(self, path, body=b'{}', private=False):
        h = object.__new__(server.Handler)
        h.path, h.command, h.request_id = path, 'POST', 'test'
        h.server = SimpleNamespace(private=private)
        h.headers = {'Content-Length': str(len(body)), 'Origin': server.PUBLIC_ORIGIN, 'X-Service-Token': server.WRITE_TOKEN}
        h.rfile = io.BytesIO(body)
        h.client_address = ('test-client', 1)
        h.reply = lambda code, value, headers=None: setattr(h, 'result', (code, value))
        return h

    def test_private_invalid_envelope_is_rejected(self):
        for body in (b'[]', b'{}'):
            h = self.handler('/internal/write', body, True)
            with patch.object(server, 'write') as writer:
                h.dispatch()
                self.assertEqual(h.result[0], 400)
                writer.assert_not_called()

    def test_login_rejects_non_object(self):
        h = self.handler('/api/v1/session/login', b'[]')
        h.dispatch()
        self.assertEqual(h.result[0], 400)

    def test_truncated_body_rejected(self):
        h = self.handler('/api/v1/runs')
        h.headers['Content-Length'] = '10'
        with self.assertRaises(ValueError): h.body()

    def test_session_tamper_and_revocation(self):
        with patch.object(server, 'users', return_value={'alice': {'role':'operator','version':1}}):
            token = server.signed_session('alice','operator',1)
            self.assertEqual(server.principal('twin_session='+token)['actor'], 'alice')
            self.assertIsNone(server.principal('twin_session='+token+'x'))
        with patch.object(server, 'users', return_value={'alice': {'role':'operator','version':2}}):
            self.assertIsNone(server.principal('twin_session='+token))

    def test_stream_capacity_does_not_block_writer(self):
        self.assertIsNot(server.stream_slots, server.private_slots)
        self.assertIsNot(server.public_slots, server.private_slots)
        acquired = []
        try:
            while server.stream_slots.acquire(False): acquired.append(True)
            self.assertTrue(server.private_slots.acquire(False))
            server.private_slots.release()
        finally:
            for _ in acquired: server.stream_slots.release()

    def test_domain_route_families_are_explicitly_routed(self):
        import re
        source = (Path(__file__).parents[2]/'apps/api/internal/httpapi/server.go').read_text()
        replacements = {'id':'example-id','action':'approve','type':'peak_surge','mode':'manual','scenario':'peak_surge'}
        for verb,path in re.findall(r'(?m)^\s*r\.(Get|Post|Delete)\("([^"]+)"',source):
            if path.startswith('/internal/'): continue
            concrete = re.sub(r'\{(\w+)\}',lambda m: replacements[m[1]],path)
            self.assertIsNotNone(resolve(verb.upper(),concrete), (verb,path))
        for path in ('/api/v1/recommendations/id/destroy','/api/v1/scenarios/unknown/start','/internal/write'):
            self.assertIsNone(resolve('POST',path))
        self.assertIsNone(resolve('DELETE','/api/v1/runs'))

if __name__ == '__main__': unittest.main()
