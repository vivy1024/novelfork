import csv
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest


TASK_DIR = Path(__file__).resolve().parents[1]
DIRTY_DATA = TASK_DIR / "environment" / "dirty_data.csv"
REFERENCE_SOLUTION = TASK_DIR / "solution" / "cleaner.py"
EXPECTED_ROWS = [
    {"name": "Alice", "email": "alice@example.com", "age": "30", "city": "Beijing"},
    {"name": "Frank", "email": "frank@example.com", "age": "0", "city": "Xi'an"},
    {"name": "Ivy", "email": "ivy@example.com", "age": "120", "city": "Suzhou"},
]


def run_cleaner(script_path: Path, input_path: Path, output_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script_path), "--input", str(input_path), "--output", str(output_path)],
        text=True,
        capture_output=True,
        check=False,
    )


def read_rows(csv_path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise AssertionError("output CSV has no header")
        rows = list(reader)
        return reader.fieldnames, rows


def validate_cleaned_output(csv_path: Path) -> None:
    if not csv_path.exists():
        raise AssertionError("cleaned_data.csv was not created")

    header, rows = read_rows(csv_path)
    assert header == ["name", "email", "age", "city"]
    assert rows == EXPECTED_ROWS


def test_reference_solution_creates_output_and_matches_expected_rows(tmp_path: Path) -> None:
    output_path = tmp_path / "cleaned_data.csv"

    result = run_cleaner(REFERENCE_SOLUTION, DIRTY_DATA, output_path)

    assert result.returncode == 0, result.stderr
    validate_cleaned_output(output_path)


def test_copy_only_wrong_solution_is_rejected(tmp_path: Path) -> None:
    wrong_script = tmp_path / "copy_only.py"
    wrong_script.write_text(
        textwrap.dedent(
            """
            import argparse
            import shutil

            parser = argparse.ArgumentParser()
            parser.add_argument("--input", required=True)
            parser.add_argument("--output", required=True)
            args = parser.parse_args()
            shutil.copyfile(args.input, args.output)
            """
        ),
        encoding="utf-8",
    )
    output_path = tmp_path / "copied.csv"

    result = run_cleaner(wrong_script, DIRTY_DATA, output_path)

    assert result.returncode == 0, result.stderr
    with pytest.raises(AssertionError):
        validate_cleaned_output(output_path)


def test_trim_only_wrong_solution_is_rejected(tmp_path: Path) -> None:
    wrong_script = tmp_path / "trim_only.py"
    wrong_script.write_text(
        textwrap.dedent(
            """
            import argparse
            import csv

            parser = argparse.ArgumentParser()
            parser.add_argument("--input", required=True)
            parser.add_argument("--output", required=True)
            args = parser.parse_args()

            with open(args.input, "r", encoding="utf-8", newline="") as src:
                reader = csv.reader(src)
                rows = [[cell.strip() for cell in row] for row in reader if any(cell.strip() for cell in row)]

            with open(args.output, "w", encoding="utf-8", newline="") as dst:
                writer = csv.writer(dst)
                writer.writerows(rows)
            """
        ),
        encoding="utf-8",
    )
    output_path = tmp_path / "trimmed.csv"

    result = run_cleaner(wrong_script, DIRTY_DATA, output_path)

    assert result.returncode == 0, result.stderr
    with pytest.raises(AssertionError):
        validate_cleaned_output(output_path)
