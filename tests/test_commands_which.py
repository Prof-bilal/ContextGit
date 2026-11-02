"""The agent-CLI lookup only accepts bare executable names."""

import pytest

from contextgit.api.projects import COMMAND_NAME


@pytest.mark.parametrize("name", ["claude", "command-code", "kilo", "cmd.exe", "agy"])
def test_bare_command_names_are_accepted(name: str) -> None:
    assert COMMAND_NAME.fullmatch(name)


@pytest.mark.parametrize("name", ["", "../claude", "a b", "C:\\tools\\x", "/usr/bin/x", "-rf", "x;rm", "a" * 65])
def test_paths_and_shell_syntax_are_rejected(name: str) -> None:
    assert not COMMAND_NAME.fullmatch(name)
