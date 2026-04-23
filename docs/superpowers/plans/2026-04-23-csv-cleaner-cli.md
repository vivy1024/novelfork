# csv-cleaner-cli Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete benchmark task package for a Python CSV-cleaning CLI and verify it locally with Docker.

**Architecture:** Keep the benchmark self-contained under `test/csv-cleaner-cli/`. Use a small Docker image with Python 3.11, a standard-library reference solution, and pytest-based verification that checks both the correct implementation and intentionally wrong implementations.

**Tech Stack:** Python 3.11, pytest, Docker, shell scripts, TOML metadata

---

### Task 1: Create task package skeleton

**Files:**
- Create: `test/csv-cleaner-cli/task.toml`
- Create: `test/csv-cleaner-cli/instruction.md`
- Create: `test/csv-cleaner-cli/environment/Dockerfile`
- Create: `test/csv-cleaner-cli/environment/dirty_data.csv`
- Create: `test/csv-cleaner-cli/solution/cleaner.py`
- Create: `test/csv-cleaner-cli/solution/solve.sh`
- Create: `test/csv-cleaner-cli/tests/test_logic.py`
- Create: `test/csv-cleaner-cli/tests/test.sh`

- [ ] Write the package files with placeholder-free content matching the approved rules.
- [ ] Ensure shell scripts use Unix line endings and executable shebangs.
- [ ] Re-check the tree against the assessment README.

### Task 2: Write failing verifier tests first

**Files:**
- Modify: `test/csv-cleaner-cli/tests/test_logic.py`

- [ ] Add a test for the reference solution producing `cleaned_data.csv`.
- [ ] Add a test for exact cleaned rows and header normalization.
- [ ] Add a test that a copy-only wrong solution fails verification.
- [ ] Add a test that a trim-only wrong solution fails verification.
- [ ] Run the verifier before implementing the final solution and confirm failure for the expected reason.

### Task 3: Implement the minimal passing solution

**Files:**
- Modify: `test/csv-cleaner-cli/solution/cleaner.py`
- Modify: `test/csv-cleaner-cli/solution/solve.sh`

- [ ] Implement CSV reading, header normalization, trimming, validation, and ordered output.
- [ ] Keep dependencies to the Python standard library.
- [ ] Re-run the verifier until the reference solution passes.

### Task 4: Finalize metadata and environment

**Files:**
- Modify: `test/csv-cleaner-cli/task.toml`
- Modify: `test/csv-cleaner-cli/instruction.md`
- Modify: `test/csv-cleaner-cli/environment/Dockerfile`

- [ ] Replace template metadata with real author, difficulty, and tags for this task.
- [ ] Write a concise English prompt that matches the verifier exactly.
- [ ] Lock Docker to `python:3.11-slim` and install only what the verifier needs.

### Task 5: Verify locally with Docker

**Files:**
- Verify only

- [ ] Run `docker build -t csv-cleaner-cli-local D:\DESKTOP\novelfork\test\csv-cleaner-cli\environment`.
- [ ] Run the container with the task directory mounted and execute `tests/test.sh`.
- [ ] Confirm the command exits `0`.
- [ ] Inspect output to ensure negative checks ran and did not silently skip.
