from pathlib import Path
from tempfile import TemporaryDirectory

from contextgit.core.models import IssueScanConfig
from contextgit.core.repo import Repo
from contextgit.issues import next_run_at, run_scan
from contextgit.llm import FakeProvider


def test_secret_scan_masks_values_and_is_stable() -> None:
    with TemporaryDirectory() as directory:
        root = Path(directory)
        secret = "ghp_" + "A" * 30
        (root / "config.py").write_text(f"TOKEN = '{secret}'\n", encoding="utf-8")
        repo = Repo.init(root)

        first = run_scan(repo)
        second = run_scan(repo)
        findings = repo.issue_findings()

        assert first.status == "done"
        assert second.status == "done"
        assert len(findings) == 2
        assert all(secret not in finding.evidence for finding in findings)
        assert findings[0].fingerprint == findings[1].fingerprint


def test_scan_uses_project_parent_when_repo_is_contextgit_directory() -> None:
    with TemporaryDirectory() as directory:
        root = Path(directory)
        metadata = root / ".contextgit"
        (root / "app.py").write_text("TOKEN = 'ghp_" + "A" * 30 + "'\n", encoding="utf-8")
        repo = Repo.init(metadata)
        result = run_scan(repo)
        assert result.steps[0]["status"] == "done"
        assert result.steps[0]["findings"] == 1
        assert repo.issue_findings()[0].location == "app.py:1"


def test_ai_review_accepts_only_real_repository_locations() -> None:
    with TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "app.py").write_text("run(user_input)\n", encoding="utf-8")
        repo = Repo.init(root)
        config = repo.issue_config()
        config.scanners = ["review"]
        repo.save_issue_config(config)
        provider = FakeProvider(
            default='{"findings":[{"rule_id":"unsafe-input","severity":"high",'
            '"confidence":0.95,"title":"Untrusted input reaches execution",'
            '"location":"app.py:1","evidence":"run(user_input)",'
            '"why":"User input is executed without validation.","fix":"Validate and sandbox input."}]}'
        )

        result = run_scan(repo, provider=provider)

        assert result.steps[-1]["status"] == "done"
        assert len(repo.issue_findings()) == 1
        assert repo.issue_findings()[0].location == "app.py:1"


def test_next_run_uses_fixed_five_hour_slots() -> None:
    config = IssueScanConfig(timezone="UTC", schedule_minute=17)
    result = next_run_at(config)
    assert result.minute == 17
    assert result.hour in {1, 6, 11, 16, 21}


def test_issue_config_round_trips_through_storage() -> None:
    with TemporaryDirectory() as directory:
        repo = Repo.init(Path(directory))
        config = repo.issue_config()
        config.enabled = True
        config.auto_create = True
        config.github_repository = "owner/repository"
        repo.save_issue_config(config)
        loaded = repo.issue_config()
        assert loaded.enabled is True
        assert loaded.auto_create is True
        assert loaded.github_repository == "owner/repository"
