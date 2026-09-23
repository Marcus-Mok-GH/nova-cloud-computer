---
description: "Create, read, edit, analyze, and explain Excel spreadsheets using Python. Use when a spreadsheet file is the primary input or output, including .xlsx, .xlsm, .xls, or .csv files."
---
# Excel spreadsheet skill

Use this skill whenever the user wants to create, read, edit, analyze, convert, or explain a spreadsheet. Work with the actual workbook, not a plain-text imitation.

## Choose the right library

Use Python in the workspace:

- `openpyxl` for `.xlsx` and `.xlsm` workbooks, formulas, formatting, charts, data validation, filters, and preserving workbook structure.
- `pandas` for tabular analysis, grouping, cleaning, joins, and reshaping. Use `openpyxl` with it when the output needs presentation formatting.
- `csv` for simple `.csv` files.
- For legacy `.xls` files, first check whether a compatible reader such as `xlrd` is installed. Do not silently rename an `.xls` file to `.xlsx`.

Before starting, inspect the workspace and locate the actual input file. Do not overwrite an existing workbook unless the user clearly asked for an in-place edit. Prefer writing a new output file with a descriptive name, then verify it.

## Creating a workbook

1. Clarify the purpose, sheets, columns, row order, and calculations. If the request is a messy list, turn it into a sensible table with short, human-readable headers.
2. Preserve provided values exactly. Never invent missing business data. Make only obvious formatting assumptions, and mention important assumptions after the file is created.
3. Use real values with real Excel number formats. Store money as numbers with a currency format, rates as decimal values with a percent format, and dates as `datetime` values with a date format. Do not put symbols into text cells.
4. Use formulas for calculations that should update when source data changes. Prefer readable formulas and named ranges when they materially improve clarity.
5. Make the workbook usable by default: bold, readable headers; frozen header rows; autofilters; sensible widths; consistent number formats; restrained colors; and no decorative blank rows or excessive merged cells.
6. Use separate sheets for genuinely different views, such as `Summary`, `Details`, and `Reference`. Keep one coherent table per sheet when possible.

Example:

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "Sales"
headers = ["Product", "Units", "Revenue", "Margin"]
ws.append(headers)
for cell in ws[1]:
    cell.font = Font(bold=True, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor="366092")
    cell.alignment = Alignment(horizontal="center")

rows = [("Product A", 100, 12500, 0.24), ("Product B", 80, 9200, 0.19)]
for row in rows:
    ws.append(row)
for cell in ws["C"][1:]:
    cell.number_format = '$#,##0.00'
for cell in ws["D"][1:]:
    cell.number_format = '0.0%'
ws.freeze_panes = "A2"
ws.auto_filter.ref = ws.dimensions
for column in ws.columns:
    letter = get_column_letter(column[0].column)
    ws.column_dimensions[letter].width = min(max(max(len(str(c.value or "")) for c in column) + 2, 10), 36)
wb.save("sales.xlsx")
wb.close()
```

## Reading and analyzing

Load with `data_only=False` when formulas must be preserved. Use `data_only=True` only when the cached formula results are what you need to inspect. For large files, use `read_only=True`; for large writes, consider `write_only=True`.

Inspect sheet names, dimensions, headers, formulas, hidden sheets, merged cells, and relevant number formats before making claims. When analyzing, check empty cells and data types, and distinguish calculated values from source values. Summarize the result in plain language, not just raw Python output.

## Editing safely

Load the existing workbook without `data_only=True` so formulas and formatting remain available. Change only the requested cells or ranges. Preserve formulas, charts, validations, freeze panes, filters, and sheet order unless the user asks to change them. Save to a new path when practical. Reopen the saved file and verify that the expected sheets, formulas, row counts, and key values are present.

For `.xlsm`, use `keep_vba=True` and do not remove macros. Treat external links and macros as potentially sensitive. Do not execute macros.

## Quality checks

After creation or editing:

1. Reopen the output workbook with `openpyxl`.
2. Confirm the expected sheet names and dimensions.
3. Check headers, formulas, number formats, and representative values.
4. Confirm that dates are dates, money and percentages are numeric, and there are no accidental `None` rows or stringified formulas.
5. If the workbook is intended for a person to use, render or inspect enough of it to catch clipped headers, unreadable widths, and confusing sheet names.
6. Tell the user exactly which file was created or changed and give a concise summary of its sheets and important assumptions.

Do not claim a workbook was created, validated, or attached until the file exists and the verification step succeeds.
