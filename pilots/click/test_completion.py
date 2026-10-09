"""Public, frozen repair contract for the Click 8.3.1 Unicode completion pilot."""
import click
import pytest


@pytest.mark.parametrize(
    ("choices", "prefix", "case_sensitive", "expected"),
    [
        (["Straße"], "STRASS", False, ["Straße"]),
        (["Straße"], "STRASSE", False, ["Straße"]),
        (["ΟΣ"], "ος", False, ["ΟΣ"]),
        (["ος"], "οσ", False, ["ος"]),
        (["ﬀoo"], "ff", False, ["ﬀoo"]),
        (["Au", "al", "Bc"], "a", False, ["Au", "al"]),
        (["Au", "al", "Bc"], "a", True, ["al"]),
        (["Straße"], "STRASS", True, []),
        (["Straße"], "Straß", True, ["Straße"]),
        (["Straße", "ΟΣ"], "", False, ["Straße", "ΟΣ"]),
        (["Straße", "ΟΣ"], "missing", False, []),
        (["MÜNCHEN"], "mün", False, ["MÜNCHEN"]),
    ],
    ids=["sharp-s-prefix", "sharp-s-full", "final-sigma-input", "final-sigma-choice",
         "ligature-prefix", "ascii-insensitive", "ascii-sensitive", "unicode-sensitive-miss",
         "unicode-sensitive-match", "empty-prefix", "missing-prefix", "accented-prefix"],
)
def test_completion_casefold(choices, prefix, case_sensitive, expected):
    choice = click.Choice(choices, case_sensitive=case_sensitive)
    option = click.Option(["--choice"], type=choice)
    ctx = click.Context(click.Command("cli", params=[option]))
    assert [c.value for c in choice.shell_complete(ctx, option, prefix)] == expected
    # Completion must retain original spelling and produce an accepted choice.
    for value in expected:
        assert choice.convert(value, option, ctx) == value


@pytest.mark.parametrize("value", ["STRASSE", "οσ", "ffoo"])
def test_conversion_contract_already_accepts_casefold(value):
    choice = click.Choice(["Straße", "ος", "ﬀoo"], case_sensitive=False)
    assert choice.convert(value, None, None) in choice.choices
