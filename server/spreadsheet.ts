import ExcelJS from "exceljs";

/** Column formats the agent can request per-column; each maps to a real Excel number format. */
export const SPREADSHEET_COLUMN_FORMATS = [
  "text",
  "integer",
  "number",
  "currency",
  "percent",
  "date",
  "datetime",
] as const;
export type SpreadsheetColumnFormat = (typeof SPREADSHEET_COLUMN_FORMATS)[number];

export function isSpreadsheetColumnFormat(value: unknown): value is SpreadsheetColumnFormat {
  return typeof value === "string" && (SPREADSHEET_COLUMN_FORMATS as readonly string[]).includes(value);
}

const NUMBER_FORMATS: Record<Exclude<SpreadsheetColumnFormat, "text">, string> = {
  integer: "#,##0",
  number: "#,##0.00",
  currency: "$#,##0.00",
  percent: "0.0%",
  date: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm",
};

export type SpreadsheetColumnInput = {
  header: string;
  key: string;
  format?: SpreadsheetColumnFormat;
  width?: number;
};

export type SpreadsheetSheetInput = {
  title: string;
  columns: SpreadsheetColumnInput[];
  rows: Array<Record<string, string | number | boolean | null | undefined>>;
};

export type SpreadsheetBuildInput = {
  sheets: SpreadsheetSheetInput[];
};

export const SPREADSHEET_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const HEADER_FILL = "FF1F2A44"; // dark navy, reads well with white bold text on any theme
const HEADER_FONT = "FFFFFFFF";
const ZEBRA_FILL = "FFF2F4F8"; // light gray-blue, subtle enough not to fight cell content
const BORDER_COLOR = "FFD9DDE3";

const THIN_BORDER = {
  top: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  left: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  bottom: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  right: { style: "thin" as const, color: { argb: BORDER_COLOR } },
};

/** Excel column/sheet names forbid these characters and a small set of reserved words. */
export function sanitizeSheetTitle(rawTitle: string, index: number): string {
  const cleaned = (rawTitle || "").replace(/[\\/*?:[\]]/g, " ").trim();
  const fallback = `Sheet${index + 1}`;
  const title = (cleaned || fallback).slice(0, 31);
  return title.length ? title : fallback;
}

function coerceCellValue(value: unknown, format: SpreadsheetColumnFormat) {
  if (value === null || value === undefined) return null;
  if (format === "date" || format === "datetime") {
    if (value instanceof Date) return value;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed;
  }
  if (format === "integer" || format === "number" || format === "currency" || format === "percent") {
    if (typeof value === "number") return format === "percent" && Math.abs(value) > 1 ? value / 100 : value;
    const numeric = Number(String(value).replace(/[,$%\s]/g, ""));
    if (Number.isNaN(numeric)) return String(value);
    return format === "percent" && Math.abs(numeric) > 1 ? numeric / 100 : numeric;
  }
  return typeof value === "boolean" ? value : String(value);
}

/** Roughly estimates a readable column width from header + sampled content, capped so one huge cell can't blow out the sheet. */
function autoWidthFor(header: string, values: unknown[]): number {
  const longest = values.reduce<number>((max, value) => {
    const length = value === null || value === undefined ? 0 : String(value).length;
    return Math.max(max, length);
  }, header.length);
  return Math.min(Math.max(longest + 2, 10), 48);
}

/**
 * Builds a formatted .xlsx workbook from plain data: bold header row with a
 * dark fill, frozen header + autofilter, sensible column widths, thin
 * borders, zebra row shading, and per-column number/currency/percent/date
 * formatting. Returns the raw file bytes ready to store or send.
 */
export async function buildSpreadsheetWorkbook(input: SpreadsheetBuildInput): Promise<Buffer> {
  if (!input.sheets.length) throw new Error("At least one sheet is required.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nova";
  workbook.created = new Date();

  const usedTitles = new Set<string>();
  input.sheets.forEach((sheetInput, sheetIndex) => {
    if (!sheetInput.columns.length) throw new Error(`Sheet "${sheetInput.title}" needs at least one column.`);
    let title = sanitizeSheetTitle(sheetInput.title, sheetIndex);
    let suffix = 2;
    while (usedTitles.has(title.toLowerCase())) {
      title = `${sanitizeSheetTitle(sheetInput.title, sheetIndex).slice(0, 28)} ${suffix}`;
      suffix += 1;
    }
    usedTitles.add(title.toLowerCase());

    const worksheet = workbook.addWorksheet(title, {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    worksheet.columns = sheetInput.columns.map(column => ({
      header: column.header,
      key: column.key,
      width:
        column.width ??
        autoWidthFor(column.header, sheetInput.rows.map(row => row[column.key])),
    }));

    sheetInput.rows.forEach(row => {
      const values: Record<string, unknown> = {};
      for (const column of sheetInput.columns) {
        values[column.key] = coerceCellValue(row[column.key], column.format ?? "text");
      }
      worksheet.addRow(values);
    });

    const headerRow = worksheet.getRow(1);
    headerRow.height = 20;
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = THIN_BORDER;
    });

    sheetInput.columns.forEach((column, columnIndex) => {
      const format = column.format ?? "text";
      const numberFormat = format === "text" ? undefined : NUMBER_FORMATS[format];
      const excelColumn = worksheet.getColumn(columnIndex + 1);
      if (numberFormat) excelColumn.numFmt = numberFormat;
      const align = format === "text" ? "left" : "right";
      for (let rowNumber = 2; rowNumber <= sheetInput.rows.length + 1; rowNumber++) {
        const cell = worksheet.getCell(rowNumber, columnIndex + 1);
        cell.border = THIN_BORDER;
        cell.alignment = { vertical: "middle", horizontal: align };
        if (rowNumber % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_FILL } };
      }
    });

    if (sheetInput.rows.length > 0) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: sheetInput.rows.length + 1, column: sheetInput.columns.length },
      };
    }
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** Ensures a user-provided file name ends in .xlsx without doubling the extension. */
export function ensureXlsxExtension(name: string): string {
  const trimmed = name.trim();
  return /\.xlsx$/i.test(trimmed) ? trimmed : `${trimmed}.xlsx`;
}

export function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
