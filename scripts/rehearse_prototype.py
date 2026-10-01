"""Authenticated recorded-input integration rehearsal against an isolated stack.

Starts and replaces virtual runs. This developer check does not replace the
non-implementer reserved-input acceptance or an independent accuracy benchmark.
"""
import argparse
import getpass
import hashlib
import http.cookiejar
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def select_sources(rows, cameras, config_hash):
    selected = {}
    for camera in cameras:
        sessions = {row['source_session_id'] for row in rows
                    if row['camera_id'] == camera and row['config_hash'] == config_hash
                    and row['status'] == 'cached_valid'}
        if len(sessions) != 1:
            raise ValueError(f'{camera} needs exactly one valid source session for this graph; select inputs in the browser when ambiguous')
        selected[camera] = sessions.pop()
    return selected


class Client:
    def __init__(self, api, origin):
        self.api, self.origin = api.rstrip('/') + '/api/v1', origin
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path, body=None):
        headers = {'Origin': self.origin, 'Content-Type': 'application/json'}
        if body is not None:
            headers['Idempotency-Key'] = str(uuid.uuid4())
        request = urllib.request.Request(self.api + path, headers=headers,
                                        data=None if body is None else json.dumps(body).encode())
        try:
            with self.http.open(request, timeout=15) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def require(self, path, body=None):
        status, result = self.call(path, body)
        if status != 200:
            raise RuntimeError(f'{path}: HTTP {status}: {result.get("message", "request failed")}')
        return result


def wait_for(callback, predicate, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = callback()
        if predicate(value):
            return value
        time.sleep(.25)
    raise RuntimeError('Acceptance condition did not complete within the declared timeout')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api', default='http://127.0.0.1:8081')
    parser.add_argument('--origin', default='http://127.0.0.1:3100')
    parser.add_argument('--username', required=True)
    parser.add_argument('--network-config', type=pathlib.Path, required=True)
    parser.add_argument('--output-dir', type=pathlib.Path, required=True)
    args = parser.parse_args()
    for url in (args.api, args.origin):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.username or parsed.password:
            parser.error('Rehearsal requires a local loopback HTTP stack')
    config = json.loads(args.network_config.read_text())
    digest = hashlib.sha256(json.dumps(config, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    client = Client(args.api, args.origin)
    client.require('/session/login', {'username': args.username, 'password': getpass.getpass('Operator password: ')})
    network = client.require('/network')
    if network['id'] != config['id']:
        raise RuntimeError('Selected graph differs from the running API')
    sessions = select_sources(client.require('/vision/clips')['clips'], config['camera_boundary_links'], digest)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for scenario in config['scenarios']:
        run = client.require('/scenarios/' + scenario['id'] + '/start', {
            'schema_version': '1.0', 'seed': scenario['seed'], 'mode': 'recommend',
            'demand_source': 'video_profile', 'source_sessions': sessions})
        rid = run['run_id']
        wait_for(lambda: client.require('/state'), lambda state: state['run_id'] == rid and state['simulation_time_s'] >= 16)
        review_started = time.monotonic()
        held = client.require('/runs/' + rid + '/clock', {'paused': True})
        _, analysis = wait_for(lambda: client.call('/analysis'), lambda response:
                              response[0] == 200 and response[1].get('run_id') == rid
                              and response[1].get('snapshot_sequence') == str(held['snapshot_sequence'])
                              and bool(response[1].get('forecasts')), timeout=12)
        review_latency = time.monotonic() - review_started
        state = client.require('/state')
        if not state['simulation_paused'] or state['input_quality'] != 'cached_valid':
            raise RuntimeError('Recorded input was not suitable for the held review state')
        horizons = sorted({forecast['horizon_s'] for forecast in analysis['forecasts']})
        if horizons != [30, 60, 120, 300]:
            raise RuntimeError('Required forecast horizons missing')
        for camera in sessions:
            observations = client.require('/observations?' + urllib.parse.urlencode({
                'camera_id': camera, 'run_id': rid, 'as_of_source_s': 15}))
            if observations['input_session_id'] != state['input_session_id'] or observations['count'] < 1:
                raise RuntimeError('Run-scoped causal observations unavailable')
        report = client.require('/runs/' + rid + '/report')
        if report['schema_version'] != 'prototype-run-report-v2' or len(report['inputs']) != len(sessions) or not report['observations'] or not report['analyses']:
            raise RuntimeError('Durable run report evidence incomplete')
        (args.output_dir / (rid + '.json')).write_text(json.dumps(report, indent=2) + '\n')
        result = {'graph': config['id'], 'scenario': scenario['id'], 'run_id': rid,
                  'input_session_id': state['input_session_id'], 'simulation_time_s': state['simulation_time_s'],
                  'forecast_count': len(analysis['forecasts']), 'horizons': horizons,
                  'outcome': analysis['outcome'], 'recorded_observations': len(report['observations']),
                  'review_state_to_analysis_wall_s': review_latency,
                  'latency_scope': 'clock request through polling exact held-snapshot analysis; includes HTTP/DB/cadence; not continuous-run p95',
                  'resources': report['resources']}
        results.append(result)
        print(json.dumps(result), flush=True)
    (args.output_dir / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__':
    main()
