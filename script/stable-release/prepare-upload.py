import json,subprocess
from pathlib import Path
tools=Path(__file__).resolve().parent
config=json.loads((tools/'config.json').read_text(encoding='utf-8'))
repo=Path.cwd().resolve()
config.update(repo_dir=str(repo),work_dir=str(repo/'release/stable-1.0.4-audit'),notes_file=str(tools/'release-notes.md'))
runtime=repo/'release/stable-runtime-config.json'
runtime.parent.mkdir(exist_ok=True)
runtime.write_text(json.dumps(config))
for phase in ['prepare','draft','upload']:
    subprocess.run(['python',str(tools/'publish-stable.py'),phase,'--config',str(runtime)],check=True)
# Never publish from this workflow: local fresh full download verification is the last gate.
