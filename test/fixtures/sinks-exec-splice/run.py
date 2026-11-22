import subprocess
def tag(name):
    subprocess.run(f'git tag "{name}"', shell=True)
def status():
    subprocess.run('git status', shell=True)
