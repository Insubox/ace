# Trusted broker: candidate imports execute only in a limited child process.
# Expected results live outside this container and are never passed to candidates.
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
if request['mode'] == 'compile':
    import py_compile
    errors = []
    for name in ('main.py', 'core.py'):
        try:
            py_compile.compile(str(root / name), cfile='/tmp/' + name + '.pyc', doraise=True)
        except py_compile.PyCompileError:
            errors.append(name)
    print(json.dumps({'compiled': not errors, 'errors': errors, 'runtime': sys.version.split()[0]}))
else:
    def limits():
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        resource.setrlimit(resource.RLIMIT_AS, (134217728, 134217728))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16384, 16384))
        resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
        resource.setrlimit(resource.RLIMIT_NPROC, (1, 1))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(
            [sys.executable, '-I', '-c', "import sys,runpy;sys.path.insert(0,'/workspace/app');runpy.run_path('/workspace/app/main.py',run_name='__main__')"],
            stdin=subprocess.PIPE, stdout=stdout, stderr=stderr, cwd=root,
            env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'},
            preexec_fn=limits, start_new_session=True)
        timed_out = False
        try:
            process.communicate(json.dumps(request['input'], ensure_ascii=False).encode(), timeout=3)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        stdout.seek(0)
        stderr.seek(0)
        print(json.dumps({'exit_code': process.returncode, 'timed_out': timed_out,
                          'stdout': stdout.read(16384).decode('utf-8', errors='replace'),
                          'stderr': stderr.read(512).decode('utf-8', errors='replace')}))
