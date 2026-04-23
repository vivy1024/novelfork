# csv-cleaner-cli Design

**Goal:** Build a complete benchmark task package named `csv-cleaner-cli` for evaluating whether an AI agent can implement a Python CSV-cleaning CLI and satisfy a robust verifier in Docker.

**Scope:** The task package lives under `test/csv-cleaner-cli/` and includes metadata, English instructions, a locked Python Docker environment, crafted dirty CSV input, a reference solution, and tests that reject common wrong implementations.

## Task Rules

The benchmark asks the AI to write a Python CLI that:

- reads `dirty_data.csv`
- writes `cleaned_data.csv`
- normalizes header names to lowercase
- trims whitespace around every field
- skips blank rows
- drops rows missing any required field: `name`, `email`, `age`, `city`
- drops rows whose `age` is not an integer in the range `0..120`
- drops rows whose `email` fails a simple `something@something.tld` pattern
- preserves the original order of valid rows

## Package Layout

The package will be created at `test/csv-cleaner-cli/` with this structure:

```text
csv-cleaner-cli/
├── task.toml
├── instruction.md
├── environment/
│   ├── Dockerfile
│   └── dirty_data.csv
├── solution/
│   ├── cleaner.py
│   └── solve.sh
└── tests/
    ├── test_logic.py
    └── test.sh
```

## Environment Design

- Base image: `python:3.11-slim`
- The Docker image contains only standard-library-based tooling plus `pytest`
- The verifier runs inside the container to avoid host Python drift
- The solution script is executable and produces deterministic output

## Test Strategy

The verifier must prove both correctness and robustness.

It will check:

1. The reference solution creates `cleaned_data.csv`.
2. The output header is lowercase and ordered as expected.
3. Only valid rows remain.
4. Valid row order is preserved.
5. A fake solution that only copies the input fails.
6. A fake solution that only trims whitespace but skips validation fails.

## Crafted Data

`dirty_data.csv` will include:

- uppercase and spaced headers
- blank lines
- rows with leading/trailing whitespace
- rows missing required values
- malformed emails
- non-numeric ages
- out-of-range ages
- a small set of valid rows that make expected output unambiguous

## Implementation Notes

- The reference solution should use only the Python standard library so the benchmark stays portable.
- The verifier should invoke candidate scripts through subprocess execution rather than importing hidden helper logic.
- Shell scripts must return exit code `0` on pass and `1` on failure.

## Verification Plan

Before claiming completion, run:

1. `docker build -t csv-cleaner-cli-local D:\DESKTOP\novelfork\test\csv-cleaner-cli\environment`
2. A container command that mounts the whole task directory and runs `tests/test.sh`
3. The verifier’s internal negative checks to confirm wrong solutions fail
