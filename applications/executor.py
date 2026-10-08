# Trusted broker. Expected outputs never enter the candidate container.
import hashlib
import json
import os
import pathlib
import resource
import signal
import subprocess
import sys
import tempfile

request = json.loads(sys.argv[1])
root = pathlib.Path('/workspace/app')
node = request.get('runtime') == 'nodejs-decimal-v1'
node_command = ['/usr/bin/node', '--jitless', '--no-addons', '--no-experimental-fetch', '--max-old-space-size=48', '--v8-pool-size=1']
environment = {'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1',
               'NODE_PATH': '/opt/ace/vendor/node_modules', 'UV_THREADPOOL_SIZE': '1'}


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
    resource.setrlimit(resource.RLIMIT_AS, ((4294967296 if node else 134217728),) * 2)
    resource.setrlimit(resource.RLIMIT_FSIZE, (16384, 16384))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_NPROC, ((1024 if node and request.get("local") else 64 if node else 1),) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def execute(command, payload=b''):
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=stdout,
                                   stderr=stderr, cwd=root, env=environment,
                                   preexec_fn=limits, start_new_session=True)
        timed_out = False
        try:
            process.communicate(payload, timeout=6 if node else 3)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        stdout.seek(0)
        stderr.seek(0)
        return {'exit_code': process.returncode, 'timed_out': timed_out,
                'stdout': stdout.read(16384).decode('utf-8', errors='replace'),
                'stderr': stderr.read(512).decode('utf-8', errors='replace')}


if request['mode'] == 'compile':
    errors = []
    if node:
        dependency = pathlib.Path('/opt/ace/vendor/node_modules/decimal.js/index.js')
        if not dependency.exists() or hashlib.sha256(dependency.read_bytes()).hexdigest() != '6e99821f8204c5f611b56077e3fce056a1562d22bc341a1f4af01afe7e527d83':
            errors.append('locked decimal.js dependency unavailable or corrupted')
        for name in ('src/main.cjs', 'src/core.js', 'web/app.js'):
            result = execute(node_command + ['--check', str(root / name)])
            if result['exit_code'] or result['timed_out']:
                errors.append(name)
        runtime = 'nodejs-decimal-v1'
    else:
        import py_compile
        for name in ('main.py', 'core.py'):
            try:
                py_compile.compile(str(root / name), cfile='/tmp/' + name + '.pyc', doraise=True)
            except py_compile.PyCompileError:
                errors.append(name)
        runtime = 'python3-stdlib-v1 / ' + sys.version.split()[0]
    print(json.dumps({'compiled': not errors, 'errors': errors, 'runtime': runtime}))
else:
    command = node_command + [str(root / 'src/main.cjs')] if node else [
        sys.executable, '-I', '-c', "import sys,runpy;sys.path.insert(0,'/workspace/app');runpy.run_path('/workspace/app/main.py',run_name='__main__')"]
    if request['mode'] == 'batch':
        inputs = request['inputs']
        if not isinstance(inputs, list) or len(inputs) > 60:
            raise ValueError('invalid trusted input batch')
        observations = []
        for item in inputs:
            observations.append(execute(command, json.dumps(item, ensure_ascii=False).encode()))
        print(json.dumps(observations))
    else:
        print(json.dumps(execute(command, json.dumps(request['input'], ensure_ascii=False).encode())))
