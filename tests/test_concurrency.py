"""Concurrent readers and writers share one SQLite connection (bugs.md B4).

FastAPI runs the sync routes on a thread pool, so the Chat screen's `/repo`,
`/branches/{name}/budget`, `/sessions` and `/staging` calls land on different
threads at the same time. With the connection unlocked, interleaved statements
raised `sqlite3.InterfaceError: bad parameter or other API misuse` and
overlapping transactions could commit each other's work.

The workload mirrors the failure: writers appending commits while readers walk
context (`branch_metrics -> build_context -> get_commit`).
"""

import threading

from contextgit.core.models import Message
from contextgit.core.repo import Repo

WRITERS = 4
WRITES_PER_WRITER = 15
READERS = 4
READS_PER_READER = 60


def test_concurrent_readers_and_writers_do_not_break_the_connection(tmp_path) -> None:
    repo = Repo.init(tmp_path / "repo")
    root_id = repo.log("main")[-1].id  # Repo.init seeds a root commit
    seed = repo.commit([Message(role="user", content="seed")], model="m")
    baseline = len(repo.all_commits())  # root + seed

    errors: list[BaseException] = []
    start = threading.Barrier(WRITERS + READERS)

    def writer(number: int) -> None:
        try:
            start.wait()
            for step in range(WRITES_PER_WRITER):
                repo.commit(
                    [Message(role="user", content=f"writer {number} step {step}")],
                    model="m",
                )
        except BaseException as exc:  # the exception *is* the regression
            errors.append(exc)

    def reader() -> None:
        try:
            start.wait()
            for _ in range(READS_PER_READER):
                repo.branch_metrics("main")
                repo.get_commit(seed.id)
                repo.log("main")
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(number,)) for number in range(WRITERS)]
    threads += [threading.Thread(target=reader) for _ in range(READERS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []

    # Every write landed as its own row.
    assert len(repo.all_commits()) == baseline + WRITERS * WRITES_PER_WRITER
    assert seed.id in {commit.id for commit in repo.all_commits()}

    # And the branch still walks a sane chain back to the root.
    chain = repo.log("main")
    assert len(set(commit.id for commit in chain)) == len(chain)
    assert chain[-1].id == root_id
    assert len(repo.build_context(chain[0].id)) >= 1
