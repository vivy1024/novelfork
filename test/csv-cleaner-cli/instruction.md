# csv-cleaner-cli

Write a Python command line tool named `cleaner.py` that cleans a messy CSV file.

## Requirements

Your program must:

1. Accept two arguments:
   - `--input`: path to the source CSV file
   - `--output`: path to the cleaned CSV file
2. Read the input CSV and write a cleaned CSV to the output path.
3. Normalize the header names to lowercase.
4. Trim leading and trailing whitespace from every field.
5. Skip completely blank rows.
6. Treat these columns as required: `name`, `email`, `age`, `city`.
7. Drop rows with any missing required value after trimming.
8. Drop rows whose `age` is not an integer in the inclusive range `0` to `120`.
9. Drop rows whose `email` does not match a simple email shape like `name@example.com`.
10. Preserve the original order of valid rows.

## Constraints

- Use Python.
- The tool should run in Linux.
- The output file must be a valid CSV with the cleaned rows only.
- Do not add extra columns or reorder the valid rows.

## Files available in the environment

- `dirty_data.csv`: a messy input file with valid and invalid rows

## Expected behavior

Running the tool should produce `cleaned_data.csv` containing only valid rows with normalized headers and trimmed values.
