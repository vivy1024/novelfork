import argparse
import csv
import re
from pathlib import Path


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
REQUIRED_FIELDS = ["name", "email", "age", "city"]


def is_blank_row(row: list[str]) -> bool:
    return not any(cell.strip() for cell in row)


def normalize_headers(header_row: list[str]) -> list[str]:
    return [cell.strip().lower() for cell in header_row]


def clean_row(row: list[str], header_count: int) -> list[str]:
    trimmed = [cell.strip() for cell in row[:header_count]]
    if len(trimmed) < header_count:
        trimmed.extend([""] * (header_count - len(trimmed)))
    return trimmed


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_PATTERN.match(value))


def is_valid_age(value: str) -> bool:
    try:
        age = int(value)
    except ValueError:
        return False
    return 0 <= age <= 120


def clean_csv(input_path: Path, output_path: Path) -> None:
    with input_path.open("r", encoding="utf-8", newline="") as src:
        reader = csv.reader(src)

        try:
            header_row = next(reader)
        except StopIteration:
            raise ValueError("input CSV is empty")

        headers = normalize_headers(header_row)
        expected_headers = REQUIRED_FIELDS
        if headers != expected_headers:
            raise ValueError(f"unexpected headers: {headers!r}")

        cleaned_rows: list[dict[str, str]] = []
        for row in reader:
            if is_blank_row(row):
                continue

            values = clean_row(row, len(headers))
            record = dict(zip(headers, values))

            if any(not record[field] for field in REQUIRED_FIELDS):
                continue
            if not is_valid_age(record["age"]):
                continue
            if not is_valid_email(record["email"]):
                continue

            cleaned_rows.append(record)

    with output_path.open("w", encoding="utf-8", newline="") as dst:
        writer = csv.DictWriter(dst, fieldnames=REQUIRED_FIELDS)
        writer.writeheader()
        writer.writerows(cleaned_rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    clean_csv(Path(args.input), Path(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
