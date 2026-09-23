---
description: "Create clear, useful Excel spreadsheets and workbooks from user data. Use when the user asks for an Excel file, spreadsheet, workbook, budget, tracker, report, table, or downloadable .xlsx, or asks to format tabular data."
---
# Spreadsheet creation

Use the `create_spreadsheet` tool whenever the user wants a real Excel workbook or downloadable spreadsheet. Do not use `create_file` for `.xlsx` output. Do not make the user describe styling unless they have a specific design in mind.

## Understand the request

Before creating the workbook, identify:

- The workbook name and the purpose of the spreadsheet.
- Whether there should be one sheet or multiple sheets.
- The columns and the rows. Preserve the user's order unless there is a clear reason not to.
- Which columns are text, whole numbers, decimals, currency, percentages, dates, or date-times.
- Any requested totals, summaries, filters, or separate views.

If the user provides an unstructured list, turn it into a sensible table. Use short, human-readable column headers and stable machine-friendly keys. Keep the source values accurate. Never invent missing business data. If an important detail is ambiguous, make the smallest reasonable assumption and mention it after creating the file.

## Tool input

Call `create_spreadsheet` with:

- `name`: a descriptive filename. The tool adds `.xlsx` when needed.
- `sheets`: one or more sheets, each with `title`, `columns`, and `rows`.
- Each column needs `header` and `key`. Set `format` when values are numeric or temporal.
- Supported formats: `text`, `integer`, `number`, `currency`, `percent`, `date`, and `datetime`.
- Use `width` only when an explicit width is useful. Otherwise let the tool size columns automatically.

Example:

```json
{
  "name": "Q1 budget",
  "sheets": [
    {
      "title": "Budget",
      "columns": [
        {"header": "Item", "key": "item", "format": "text"},
        {"header": "Cost", "key": "cost", "format": "currency"},
        {"header": "Share", "key": "share", "format": "percent"}
      ],
      "rows": [
        {"item": "Rent", "cost": 1200, "share": 0.4},
        {"item": "Food", "cost": 600, "share": 0.2}
      ]
    }
  ]
}
```

## Formatting choices

The spreadsheet tool already applies a readable default style: a bold header, frozen header row, autofilter, sensible column widths, borders, and subtle alternating row shading. Prefer the correct `format` over putting symbols into values. For example, use `1200` with `currency`, `0.4` with `percent`, and an ISO date string with `date`.

Use separate sheets for genuinely different views, such as `Summary`, `Details`, and `Reference`. Keep a single table on a sheet when possible. Avoid decorative sheets, merged cells, fake spacing rows, or excessive colors.

## After creation

The tool returns the created file path and metadata. Tell the user what was created, including the sheet names and approximate row counts when useful. Present the file so it is downloadable. If the request asked for analysis as well as a file, give a concise summary alongside the workbook.
