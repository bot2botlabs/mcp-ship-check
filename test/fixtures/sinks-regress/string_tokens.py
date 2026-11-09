# A code scanner that lists exec/fs tokens as STRINGS must not self-flag.
SPAWN_TOKENS = ("subprocess", "os.system(", "os.popen(", "child_process")
FS_TOKENS = ("readFileSync(", "open(", "writeFile(")
NOTE = "Call subprocess.run(cmd, shell=True) is unsafe"  # prose mentioning it
