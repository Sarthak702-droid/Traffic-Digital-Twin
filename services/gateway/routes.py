"""Explicit public method/path ownership. No user-controlled upstream URLs."""
import re
ROUTES = [
 ("GET", r"/api/v1/(network|state|health|runs|analysis|audit|mode|locks)", "query", False),
 ("GET", r"/api/v1/junctions/[^/]+", "query", False),
 ("GET", r"/api/v1/recommendations/active", "decision", False),
 ("GET", r"/api/v1/decisions/unresolved", "decision", False),
 ("POST", r"/api/v1/runs", "lifecycle", True),
 ("POST", r"/api/v1/scenarios/(peak_surge|incident_c3|ambulance_corridor)/start", "lifecycle", True),
 ("POST", r"/api/v1/scenarios/reset", "lifecycle", True),
 ("POST", r"/api/v1/recommendations/[^/]+/(simulate|approve|modify|reject)", "decision", True),
 ("POST", r"/api/v1/decisions/resolve", "decision", True),
 ("POST", r"/api/v1/mode/(recommend|recommendation|observe|manual)", "control", True),
 ("POST", r"/api/v1/locks/[^/]+", "control", True),
 ("DELETE", r"/api/v1/locks/[^/]+", "control", True),
 ("POST", r"/api/v1/replay/(peak_surge|incident_c3|ambulance_corridor)", "replay", True),
 ("GET", r"/ws/v1/live", "stream", False),
]
def resolve(method, path):
    for verb, pattern, owner, durable in ROUTES:
        if method == verb and re.fullmatch(pattern, path):
            return owner, durable
    return None
