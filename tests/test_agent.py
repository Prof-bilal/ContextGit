import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from contextgit.agent import approve_plan, commit_run, create_run
from contextgit.agent.service import _clean_patch
from contextgit.core.repo import Repo


class ScriptedProvider:
    def complete(self, messages: list[object], **_: object) -> str:
        prompt = str(messages[-1].content)  # type: ignore[attr-defined]
        if '"patch"' in prompt:
            return json.dumps(
                {
                    "patch": """diff --git a/app.py b/app.py
index 3b18e51..b2d9e5e 100644
--- a/app.py
+++ b/app.py
@@ -1 +1 @@
-return 1
+return 2
"""
                }
            )
        return json.dumps(
            {
                "summary": "Update the return value",
                "steps": ["Change app.py", "Run available checks"],
                "files": ["app.py"],
                "checks": [],
                "risks": [],
            }
        )


def test_agent_strips_markdown_wrappers_from_generated_patches() -> None:
    patch = _clean_patch("Here is the patch:\n```diff\ndiff --git a/app.py b/app.py\n```\n")
    assert patch.strip() == "diff --git a/app.py b/app.py"


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def test_agent_uses_isolated_worktree_and_commit() -> None:
    with TemporaryDirectory() as directory:
        root = Path(directory) / "fixture"
        root.mkdir()
        git(root, "init", "-b", "main")
        git(root, "config", "user.name", "ContextGit Test")
        git(root, "config", "user.email", "test@contextgit.local")
        (root / "app.py").write_text("return 1\n", encoding="utf-8")
        git(root, "add", "app.py")
        git(root, "commit", "-m", "initial")
        repo = Repo.init(root / ".contextgit")

        run = create_run(repo, "Update the return value", ScriptedProvider())
        assert run.status == "awaiting_approval"
        assert run.worktree_path
        assert (root / "app.py").read_text(encoding="utf-8") == "return 1\n"

        run = approve_plan(repo, run.id, ScriptedProvider())
        assert run.status == "ready", run.error
        assert (root / "app.py").read_text(encoding="utf-8") == "return 1\n"
        assert Path(run.worktree_path, "app.py").read_text(encoding="utf-8") == "return 2\n"

        run = commit_run(repo, run.id)
        assert run.status == "completed"
        assert run.resulting_commit
        assert git(Path(run.worktree_path), "log", "-1", "--format=%s") == "Update the return value"
