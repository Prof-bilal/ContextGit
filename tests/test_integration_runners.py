"""Exercise the real adapters against local fake CLI processes."""

import threading

import pytest

from contextgit.integration.runners import Cancelled, CLIRunner, execute


@pytest.mark.parametrize("harness", ["codex", "claude"])
def test_structured_cli_protocol(tmp_path, harness):
    executable = tmp_path / harness
    executable.write_text("""#!/usr/bin/env python3
import json,sys
verdict = {"verdict":"approve","feedback":"fixture","patch":""}
if "--help" in sys.argv:
 print("--listen --json-schema --tools --strict-mcp-config --setting-sources")
elif "app-server" in sys.argv:
 for line in sys.stdin:
  request = json.loads(line)
  method = request.get("method")
  if method == "initialize":
   print(json.dumps({"id":request["id"],"result":{}}),flush=True)
  elif method == "thread/start":
   assert request["params"]["sandbox"] == "readOnly"
   assert request["params"]["approvalPolicy"] == "unlessTrusted"
   print(json.dumps({"id":request["id"],"result":{"thread":{"id":"fixture"}}}),flush=True)
  elif method == "turn/start":
   print(json.dumps({"method":"thread/tokenUsage/updated","params":{"tokenUsage":{"total":{"totalTokens":12}}}}),flush=True)
   print(json.dumps({"method":"item/completed","params":{"item":{"type":"agentMessage","text":json.dumps(verdict)}}}),flush=True)
   print(json.dumps({"method":"turn/completed","params":{"turn":{"status":"completed"}}}),flush=True)
else:
 assert "--dangerously-skip-permissions" not in sys.argv
 assert sys.argv[sys.argv.index("--tools")+1] == ""
 assert sys.argv[sys.argv.index("--setting-sources")+1] == ""
 assert json.loads(sys.argv[sys.argv.index("--settings")+1])["disableAllHooks"]
 sys.stdin.read()
 print(json.dumps({"structured_output":verdict,"usage":{"input_tokens":12}}))
""")
    executable.chmod(0o700)
    runner = CLIRunner()
    runner.capability = lambda _: str(executable)
    usage = []
    result = runner.review(harness, "fixture prompt", threading.Event(), usage.append)
    assert result["verdict"] == "approve"
    assert usage


def test_check_cancellation_kills_process(tmp_path):
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(Cancelled):
        execute(["/bin/sh", "-c", "sleep 30"], tmp_path, cancel)


def test_invalid_structured_verdict(tmp_path):
    executable = tmp_path / "bad"
    executable.write_text(
        '#!/bin/sh\ncat >/dev/null\necho \'{"structured_output":{"verdict":"maybe"}}\'\n'
    )
    executable.chmod(0o700)
    runner = CLIRunner()
    runner.capability = lambda _: str(executable)
    with pytest.raises(RuntimeError, match="invalid review"):
        runner.review("claude", "fixture", threading.Event(), lambda value: None)


def test_check_timeout(tmp_path):
    with pytest.raises(RuntimeError, match="timeout"):
        execute(["/bin/sh", "-c", "sleep 30"], tmp_path, threading.Event(), timeout=0)
