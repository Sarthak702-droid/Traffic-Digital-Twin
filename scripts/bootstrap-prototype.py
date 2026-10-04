#!/usr/bin/env python3
"""Canonical local setup and read-only preflight; never download private assets."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
MODEL_HASH='06006ecb5fe52a348ceed805bf0aa6b32af7e24e689d09a6582f6d53159d6b00'

def frontend_dependencies_match(root):
    # npm validates required/peer dependency resolution for the active workspace
    # graph. Lockfiles also contain uninstalled platform-specific or inactive
    # historical entries; their absence is not a missing runtime dependency.
    try:
        packages=json.loads((root/'package-lock.json').read_text())['packages']
        graph=subprocess.run(['npm','ls','--all','--parseable'],cwd=root,capture_output=True,text=True)
        if graph.returncode:return False
        for entry in graph.stdout.splitlines():
            relative=Path(entry).relative_to(root).as_posix()
            if 'node_modules/' not in relative:continue
            locked=packages.get(relative)
            if not locked:return False
            if locked.get('link'):continue
            if json.loads((Path(entry)/'package.json').read_text()).get('version')!=locked.get('version'):return False
        return True
    except (OSError,ValueError,KeyError):return False

def doctor(model,media_root):
    checks=[]
    def record(name,ok,detail):checks.append({'check':name,'status':'passed' if ok else 'blocked','detail':detail})
    record('python',sys.version_info>=(3,12),'Python 3.12+ required')
    for name,minimum in [('node',22),('go',1)]:
        try:
            value=subprocess.check_output([name,'--version' if name=='node' else 'version'],text=True).strip()
            version=value.lstrip('v').split('.')[0] if name=='node' else value.split()[2].removeprefix('go')
            ok=int(version)>=minimum if name=='node' else tuple(map(int,version.split('.')[:2]))>=(1,25)
            record(name,ok,value)
        except (OSError,ValueError,subprocess.CalledProcessError):record(name,False,'Required runtime unavailable')
    record('frontend_dependencies',frontend_dependencies_match(ROOT),'Active npm workspace graph must resolve and installed versions must match the committed lock')
    for line in (ROOT/'services/runtime-requirements.lock').read_text().splitlines():
        if '==' not in line:continue
        name,want=line.split('==',1)
        try:ok=importlib.metadata.version(name)==want
        except importlib.metadata.PackageNotFoundError:ok=False
        record('dependency:'+name,ok,'Must match committed runtime lock')
    plugins={}
    for name,version in [('protoc-gen-go','v1.36.12'),('protoc-gen-go-grpc','1.6.2')]:
        path=ROOT/'.runtime/tools'/name
        executable=str(path) if path.is_file() else shutil.which(name)
        try:
            value=subprocess.check_output([executable,'--version'],text=True).strip()
            ok=version in value;record(name,ok,value)
            if ok:plugins[name]=executable
        except (OSError,TypeError,subprocess.CalledProcessError):record(name,False,'Install pinned generators through bootstrap')
    if len(plugins)==2:
        with tempfile.TemporaryDirectory(prefix='traffic-contract-doctor-') as temp:
            dest=Path(temp);(dest/'python').mkdir();(dest/'go').mkdir()
            args=[str(ROOT/'.venv/bin/python'),'-m','grpc_tools.protoc','-I','packages/contracts/proto',
                  '--python_out='+str(dest/'python'),'--grpc_python_out='+str(dest/'python'),
                  '--go_out='+str(dest/'go'),'--go_opt=paths=source_relative','--go-grpc_out='+str(dest/'go'),'--go-grpc_opt=paths=source_relative']
            args+=['--plugin='+name+'='+path for name,path in plugins.items()]+['packages/contracts/proto/twin.proto']
            result=subprocess.run(args,cwd=ROOT,capture_output=True)
            same=result.returncode==0 and all(file.read_bytes()==(ROOT/'packages/contracts/gen'/kind/file.name).read_bytes() for kind in ('python','go') for file in (dest/kind).iterdir())
            record('generated_bindings',same,'Regenerated into temporary directory; repository is unchanged')
    else:record('generated_bindings',False,'Pinned generators unavailable')
    try:
        result=subprocess.run([str(ROOT/'.venv/bin/python'),'scripts/verify-contracts.py'],cwd=ROOT,capture_output=True)
        record('contracts',result.returncode==0,'Generated contracts and public ownership verification')
    except OSError:record('contracts',False,'Repository virtualenv unavailable')
    try:
        result=subprocess.run(['docker','compose','exec','-T','postgres','psql','-U','traffic','-d','traffic','-Atc','SHOW server_version_num'],cwd=ROOT,capture_output=True,text=True)
        record('postgres',result.returncode==0 and int(result.stdout.strip())>=160000,'PostgreSQL 16+ reachable')
    except (OSError,ValueError):record('postgres',False,'PostgreSQL 16+ unavailable')
    digest=hashlib.sha256()
    if model.is_file():
        with model.open('rb') as source:
            for chunk in iter(lambda:source.read(1<<20),b''):digest.update(chunk)
    record('detector_checkpoint',model.is_file() and digest.hexdigest()==MODEL_HASH,'Supply verified private ITD checkpoint; never committed/downloaded by bootstrap')
    record('media_root',media_root is not None and media_root.is_dir(),'Supply an authorized recorded-media directory')
    env_path=ROOT/'.runtime/local-env.json'
    env=json.loads(env_path.read_text()) if env_path.is_file() else {}
    account=Path(os.environ.get('GATEWAY_USERS_FILE') or env.get('GATEWAY_USERS_FILE',ROOT/'.runtime/gateway-users.json'))
    try:
        accounts=json.loads(account.read_text())
        valid=bool(accounts) and account.stat().st_mode&0o077==0 and all(v.get('role') in ('viewer','operator','supervisor') and type(v.get('version')) is int and v['version']>0 and len(v.get('salt',''))>=32 and len(v.get('hash',''))==64 for v in accounts.values())
    except (OSError,ValueError,TypeError,AttributeError):valid=False
    record('accounts',valid,'Provision an account with create-gateway-user.py; no default password')
    return {'status':'ready_for_local_rehearsal' if all(c['status']=='passed' for c in checks) else 'blocked','acceptance':'not_verified','checks':checks}

def main(argv=None):
    p=argparse.ArgumentParser();p.add_argument('--doctor',action='store_true');p.add_argument('--model',type=Path,default=ROOT/'.runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt');p.add_argument('--authorized-root',type=Path);args=p.parse_args(argv)
    if not args.doctor:
        commands=[[sys.executable,'-m','venv',str(ROOT/'.venv')],[str(ROOT/'.venv/bin/python'),'-m','pip','install','-r','services/runtime-requirements.lock'],['npm','ci'],['go','mod','download'],['docker','compose','up','-d','--wait','postgres'],[str(ROOT/'.venv/bin/python'),'scripts/bootstrap-local.py'],['npm','run','build']]
        tools=ROOT/'.runtime/tools';tools.mkdir(parents=True,exist_ok=True)
        for command in commands:subprocess.run(command,cwd=ROOT,check=True)
        for package in ['google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.12','google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.2']:
            subprocess.run(['go','install',package],cwd=ROOT,env={**os.environ,'GOBIN':str(tools)},check=True)
        print('Dependencies installed. Provision the account and supply authorized media/checkpoint, then run --doctor. Acceptance remains unverified.')
        return 0
    result=doctor(args.model,args.authorized_root);print(json.dumps(result,indent=2));return 0 if result['status']=='ready_for_local_rehearsal' else 1

if __name__=='__main__':raise SystemExit(main())
