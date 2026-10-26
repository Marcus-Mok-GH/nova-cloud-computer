type KilobyteFormat = "whole" | "decimal";

/** Formats a file size, preserving the UI's whole- or decimal-KB display. */
export function formatFileSize(
  bytes: number,
  kilobyteFormat: KilobyteFormat = "whole",
): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kilobytes = bytes / 1024;
    const value =
      kilobyteFormat === "whole"
        ? Math.round(kilobytes)
        : kilobytes.toFixed(1);
    return `${value} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
