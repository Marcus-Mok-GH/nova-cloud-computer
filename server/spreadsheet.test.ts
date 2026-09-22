import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildSpreadsheetWorkbook,
  bufferToDataUrl,
  ensureXlsxExtension,
  isSpreadsheetColumnFormat,
  sanitizeSheetTitle,
  SPREADSHEET_MIME_TYPE,
} from "./spreadsheet";

describe("Spreadsheet builder", () => {
  it("recognizes only the supported column formats", () => {
    expect(isSpreadsheetColumnFormat("currency")).toBe(true);
    expect(isSpreadsheetColumnFormat("bogus")).toBe(false);
    expect(isSpreadsheetColumnFormat(42)).toBe(false);
  });

  it("adds .xlsx exactly once", () => {
    expect(ensureXlsxExtension("Budget")).toBe("Budget.xlsx");
    expect(ensureXlsxExtension("Budget.xlsx")).toBe("Budget.xlsx");
    expect(ensureXlsxExtension("Budget.XLSX")).toBe("Budget.XLSX");
  });

  it("sanitizes sheet titles to valid, unique-safe Excel names", () => {
    expect(sanitizeSheetTitle("Q1 Sales", 0)).toBe("Q1 Sales");
    expect(sanitizeSheetTitle("Rev/Exp:Report*", 0)).toBe("Rev Exp Report");
    expect(sanitizeSheetTitle("", 2)).toBe("Sheet3");
    expect(sanitizeSheetTitle("x".repeat(50), 0).length).toBeLessThanOrEqual(31);
  });

  it("builds a workbook with a styled header row, frozen pane, and autofilter", async () => {
    const buffer = await buildSpreadsheetWorkbook({
      sheets: [
        {
          title: "Budget",
          columns: [
            { header: "Item", key: "item" },
            { header: "Cost", key: "cost", format: "currency" },
            { header: "Share", key: "share", format: "percent" },
          ],
          rows: [
            { item: "Rent", cost: 1200, share: 0.4 },
            { item: "Food", cost: 600, share: 0.2 },
          ],
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Budget");
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(1).getCell(1).value).toBe("Item");
    expect(sheet!.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(sheet!.getRow(2).getCell(2).value).toBe(1200);
    expect(sheet!.getColumn(2).numFmt).toBe("$#,##0.00");
    expect(sheet!.getColumn(3).numFmt).toBe("0.0%");
    expect(sheet!.views?.[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet!.autoFilter).toBeTruthy();
  });

  it("builds multiple sheets and de-duplicates a repeated title", async () => {
    const buffer = await buildSpreadsheetWorkbook({
      sheets: [
        { title: "Data", columns: [{ header: "A", key: "a" }], rows: [{ a: 1 }] },
        { title: "Data", columns: [{ header: "B", key: "b" }], rows: [{ b: 2 }] },
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Data", "Data 2"]);
  });

  it("rejects an empty sheet list or a sheet with no columns", async () => {
    await expect(buildSpreadsheetWorkbook({ sheets: [] })).rejects.toThrow();
    await expect(
      buildSpreadsheetWorkbook({ sheets: [{ title: "Empty", columns: [], rows: [] }] })
    ).rejects.toThrow();
  });

  it("wraps workbook bytes into a valid xlsx data URL", async () => {
    const buffer = await buildSpreadsheetWorkbook({
      sheets: [{ title: "S", columns: [{ header: "A", key: "a" }], rows: [{ a: 1 }] }],
    });
    const dataUrl = bufferToDataUrl(buffer, SPREADSHEET_MIME_TYPE);
    expect(dataUrl.startsWith(`data:${SPREADSHEET_MIME_TYPE};base64,`)).toBe(true);
    const decoded = Buffer.from(dataUrl.split(",")[1], "base64");
    expect(decoded.equals(buffer)).toBe(true);
  });
});
