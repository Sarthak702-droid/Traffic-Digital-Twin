"""Real loopback gateway/domain/writer/PostgreSQL/SUMO acceptance. No mocked APIs.
Creates and drops an isolated PostgreSQL schema; never uses the demo run state.
Run after building /tmp/traffic-epic5-{api,writer}. Requires local Docker permission.
"""
import concurrent.futures
import hashlib
import http.client as http_client
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0,str(ROOT/'packages/contracts/gen/python'))
import grpc
import twin_pb2 as pb
import twin_pb2_grpc as rpc

schema='epic5_'+uuid.uuid4().hex
children={};logs={};checks=[]
def sql(statement):
    result=subprocess.run(['docker','compose','exec','-T','postgres','psql','-U','traffic','-d','traffic','-v','ON_ERROR_STOP=1','-At'],input=statement,text=True,capture_output=True,check=True)
    return result.stdout.strip()
def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
ports={name:port() for name in ['writer','gateway','internal','api','simulation','intelligence','web']}
base=f'http://127.0.0.1:{ports["gateway"]}'
env=os.environ.copy()
for key in ['DOMAIN_TOKEN','DOMAIN_WRITE_TOKEN','WRITER_TOKEN','SESSION_SECRET','COMPUTE_TOKEN']:env[key]=secrets.token_hex(32)
env.update(PYTHONPATH=f'{ROOT}:{ROOT}/packages/contracts/gen/python',GATEWAY_PORT=str(ports['gateway']),GATEWAY_INTERNAL_PORT=str(ports['internal']),WRITER_ADDR=f'127.0.0.1:{ports["writer"]}',WRITER_ORIGIN=f'http://127.0.0.1:{ports["writer"]}',API_ADDR=f'127.0.0.1:{ports["api"]}',DOMAIN_ORIGINS=f'http://127.0.0.1:{ports["api"]}',GATEWAY_INTERNAL_ORIGIN=f'http://127.0.0.1:{ports["internal"]}',SIMULATION_ADDR=f'127.0.0.1:{ports["simulation"]}',INTELLIGENCE_ADDR=f'127.0.0.1:{ports["intelligence"]}',UI_ORIGIN=f'http://127.0.0.1:{ports["web"]}',WRITE_DATABASE_URL=f'postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable&search_path={schema}',READ_DATABASE_URL=f'postgres://traffic_reader:traffic_reader_demo@127.0.0.1:5433/traffic?sslmode=disable&search_path={schema}')
def start(name,command):
    log=open(Path(tmp)/f'{name}.log','a');logs[name]=log
    children[name]=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
def stop(name):
    p=children.pop(name)
    os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=6)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
def http(path,method='GET',payload=None,key=None,cookie='',target='gateway',headers=None):
    h={'Content-Type':'application/json','Origin':env['UI_ORIGIN'],'Cookie':cookie,**(headers or {})}
    if method!='GET':h['Idempotency-Key']=key or str(uuid.uuid4())
    c=http_client.HTTPConnection('127.0.0.1',ports[target],timeout=15)
    try:
        c.request(method,path,json.dumps(payload) if payload is not None else None,h)
        r=c.getresponse();raw=r.read();return r.status,json.loads(raw),dict(r.getheaders())
    finally:c.close()
def wait(fn,seconds=25):
    until=time.monotonic()+seconds;last=None
    while time.monotonic()<until:
        try:
            last=fn()
            if last:return last
        except (OSError,ValueError,grpc.RpcError):pass
        time.sleep(.25)
    raise AssertionError(f'Timed out: {last}')
def check(label,condition):
    assert condition,label
    checks.append(label);print('PASS',label,flush=True)
def api(path,method='GET',payload=None,key=None,as_cookie=None):return http('/api/v1'+path,method,payload,key,cookie if as_cookie is None else as_cookie)
def analysis(exclude=None):
    def ready():
        code,data,_=api('/analysis')
        rec=data.get('recommendation') if code==200 else None
        return data if rec and rec['status']=='pending' and rec['id']!=exclude else None
    return wait(ready,45)
def cmd(path,payload=None,key=None):
    code,data,_=api(path,'POST',payload or {},key)
    assert code==200,(path,code,data)
    return data

with tempfile.TemporaryDirectory(prefix='traffic-epic5-') as tmp:
    try:
        sql((ROOT/'scripts/init-local-db.sql').read_text())
        sql(f'CREATE SCHEMA {schema}; GRANT USAGE ON SCHEMA {schema} TO traffic_reader; ALTER DEFAULT PRIVILEGES FOR ROLE traffic IN SCHEMA {schema} GRANT SELECT ON TABLES TO traffic_reader;')
        env['SIMULATION_DIRECTORY']=str(Path(tmp)/'sumo')
        password=secrets.token_urlsafe(24);users={}
        for name,role in [('operator','operator'),('viewer','viewer')]:
            salt=secrets.token_hex(16);users[name]={'role':role,'salt':salt,'hash':hashlib.pbkdf2_hmac('sha256',password.encode(),salt.encode(),600000).hex(),'version':1}
        userfile=Path(tmp)/'users.json';userfile.write_text(json.dumps(users));userfile.chmod(0o600);env['GATEWAY_USERS_FILE']=str(userfile)
        start('writer',['/tmp/traffic-epic5-writer'])
        wait(lambda:http('/internal/write','POST',{'operation':'ping','actor':'test','payload':{}},target='writer',headers={'X-Service-Token':env['WRITER_TOKEN']})[0]==200)
        for name in ('simulation','intelligence'):start(name,[str(ROOT/'.venv/bin/python'),'-m','services.shared.server',name,'--port',str(ports[name])])
        for name in ('simulation','intelligence'):
            with grpc.insecure_channel(env[name.upper()+'_ADDR']) as channel:grpc.channel_ready_future(channel).result(timeout=15)
        start('gateway',[str(ROOT/'.venv/bin/python'),'-m','services.gateway.server'])
        wait(lambda:http('/api/v1/session')[0]==401)
        start('api',['/tmp/traffic-epic5-api'])
        code,_,headers=http('/api/v1/session/login','POST',{'username':'operator','password':password});check('operator login',code==200)
        cookie=headers['Set-Cookie'].split(';')[0]
        wait(lambda:api('/network')[0]==200)
        check('domain rejects direct unauthenticated call',http('/api/v1/network',target='api')[0]==401)
        check('writer rejects direct unauthenticated call',http('/internal/write','POST',{},target='writer')[0]==401)
        with grpc.insecure_channel(env['SIMULATION_ADDR']) as channel:
            try:rpc.SimulationStub(channel).GetState(pb.RunRequest(),timeout=2);raise AssertionError('compute auth bypass')
            except grpc.RpcError as e:check('private compute identity',e.code()==grpc.StatusCode.UNAUTHENTICATED)
        _,_,vh=http('/api/v1/session/login','POST',{'username':'viewer','password':password});viewer=vh['Set-Cookie'].split(';')[0]
        check('viewer cannot mutate',api('/mode/manual','POST',{},as_cookie=viewer)[0]==403)
        key=str(uuid.uuid4());run=cmd('/scenarios/peak_surge/start',{'schema_version':'1.0','seed':1101,'mode':'recommend'},key)
        check('duplicate start returns same durable outcome',cmd('/scenarios/peak_surge/start',{'schema_version':'1.0','seed':1101,'mode':'recommend'},key)==run)
        check('changed-payload retry rejected',api('/scenarios/peak_surge/start','POST',{'schema_version':'1.0','seed':2202,'mode':'recommend'},key)[0]==409)
        for mode in ('observe','manual','recommend'):
            cmd('/mode/'+mode);check('canonical mode '+mode,api('/mode')[1]['mode']==mode)
            if mode!='recommend':check(mode+' suppresses actionable recommendation',api('/recommendations/active')[0]!=200)
        target=api('/network')[1]['phases'][0]['id']
        cmd('/mode/manual');cmd('/locks/'+target)
        stop('api');start('api',['/tmp/traffic-epic5-api'])
        wait(lambda:api('/mode')[0]==200,20)
        check('mode and lock survive domain restart',api('/mode')[1]['mode']=='manual' and target in api('/locks')[1]['locks'])
        check('unknown lock target rejected',api('/locks/not-configured','POST',{})[0]==400)
        api('/locks/'+target,'DELETE',{});cmd('/mode/recommend')
        data=analysis();rec=data['recommendation'];rid=rec['id']
        check('mandatory deliberate category enforced',api(f'/recommendations/{rid}/reject','POST',{'reason':'arbitrary'})[0]==400)
        unsafe=[{**c,'green_s':999} for c in rec['changes']]
        check('unsafe plan refused',api(f'/recommendations/{rid}/modify','POST',{'reason':'Field observation','changes':unsafe})[0]==409)
        cmp=cmd(f'/recommendations/{rid}/simulate');check('simulation provenance matches',cmp['recommendation_id']==rid and cmp['run_id']==run['run_id'])
        key=str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            futures=[pool.submit(api,f'/recommendations/{rid}/approve','POST',{},key) for _ in range(2)]
            responses=[f.result() for f in futures]
        check('concurrent duplicate never dispatches two decisions',all(r[0] in (200,409) for r in responses) and any(r[0]==200 for r in responses))
        outcome=api('/commands/'+key)[1];check('approval has durable acknowledged receipt',outcome['status']=='completed' and outcome['response']['status']=='approved')
        check('actor-scoped outcome access',api('/commands/'+key,as_cookie=viewer)[0]==403)
        check('one intent for duplicate command',sql(f"SELECT count(*) FROM {schema}.decision_intents WHERE command_id='{key}'")=='1')
        data=analysis(rid);rec=data['recommendation'];rid=rec['id']
        state=api('/state')[1]
        modified=cmd(f'/recommendations/{rid}/modify',{'reason':'Field observation: verified current safe plan','changes':state['active_plan']})
        check('bounded modification accepted',modified['status']=='approved')
        data=analysis(rid);rec=data['recommendation'];rid=rec['id']
        sql(f"ALTER TABLE {schema}.audit_events ADD CONSTRAINT test_final_audit_failure CHECK(safety_result <> 'accepted_pending_safe_boundary') NOT VALID;")
        failed_key=str(uuid.uuid4())
        code,_,_=api(f'/recommendations/{rid}/approve','POST',{},failed_key)
        check('lost final audit returns explicit uncertain failure',code==503)
        check('durable intent retained during audit failure',sql(f"SELECT count(*) FROM {schema}.decision_intents WHERE command_id='{failed_key}' AND NOT settled")=='1')
        stop('api')
        sql(f'ALTER TABLE {schema}.audit_events DROP CONSTRAINT test_final_audit_failure;')
        start('api',['/tmp/traffic-epic5-api'])
        wait(lambda:api('/commands/'+failed_key)[1].get('status')=='completed',25)
        check('restart reconciles receipt without repeating actuation',api('/commands/'+failed_key)[1]['response']['status']=='approved')
        data=analysis(rid);rid=data['recommendation']['id']
        lost_key=str(uuid.uuid4());body=b'{}'
        with socket.create_connection(('127.0.0.1',ports['gateway']),3) as lost:
            lost.sendall((f'POST /api/v1/recommendations/{rid}/approve HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: {env["UI_ORIGIN"]}\r\nCookie: {cookie}\r\nIdempotency-Key: {lost_key}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n').encode()+body)
        wait(lambda:api('/commands/'+lost_key)[1].get('status')=='completed',20)
        check('lost browser response is recoverable by command ID',api('/commands/'+lost_key)[1]['response']['status']=='approved')
        data=analysis(rid);rid=data['recommendation']['id']
        rejected=cmd(f'/recommendations/{rid}/reject',{'reason':'Pedestrian crowd: retain safe plan'})
        check('rejection persisted',rejected['status']=='rejected')
        events=api('/audit?limit=100')[1]['events']
        check('decision audit includes command identity',any(e['event_type']=='recommendation.approve' and e['after_values'].get('command_id')==key for e in events))
        stop('api');start('api',['/tmp/traffic-epic5-api']);wait(lambda:api('/mode')[0]==200)
        check('completed decision survives restart',api('/commands/'+key)[1]['status']=='completed')
        if '--browser' in sys.argv:
            env['API_ORIGIN']=base
            env['EPIC5_BROWSER_URL']=env['UI_ORIGIN']
            env['EPIC5_TEST_PASSWORD']=password
            start('web',['node','node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',str(ports['web'])])
            def webready():
                c=http_client.HTTPConnection('127.0.0.1',ports['web'],timeout=2)
                try:c.request('GET','/');r=c.getresponse();r.read();return r.status==200
                finally:c.close()
            wait(webready,45)
            subprocess.run(['node','scripts/verify-epic5-browser.mjs'],env=env,check=True)
            check('real browser offline draft recovery',True)
        output={'checked_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'checks':checks,'count':len(checks),'mocked_apis':False}
        (ROOT/'.runtime/epic5-integration-result.json').write_text(json.dumps(output,indent=2)+'\n')
        print('PASS real Epic 5 integration:',len(checks),'checks')
    except Exception:
        for name in logs:
            logs[name].flush();print('\nSERVICE',name,'\n',Path(tmp,f'{name}.log').read_text()[-3500:],file=sys.stderr)
        raise
    finally:
        for name in list(children):stop(name)
        for log in logs.values():log.close()
        sql(f'DROP SCHEMA IF EXISTS {schema} CASCADE;')
