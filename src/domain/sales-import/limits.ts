/**
 * Resource limits for uploaded XLSX files. Kept free of Node APIs so the browser can use the
 * same numbers for early feedback; enforcement happens server-side in archive-limits.ts/xlsx.ts.
 */
export interface InputLimits {
  /** Compressed upload size. */
  maxFileBytes: number;
  maxArchiveEntries: number;
  /** Largest single inflated entry (in practice, the sheet XML). */
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  /** Cells covered by merged ranges, summed over every sheet (checked before loading). */
  maxMergedCells: number;
  /**
   * Rows, cells and column objects on every sheet, plus cells covered by data validations and
   * named ranges: what the spreadsheet library materializes before the extent checks below.
   */
  maxWorkbookCells: number;
  /** Rows below the header on the selected sheet, including blank rows. */
  maxDataRows: number;
  maxColumns: number;
}

const MiB = 1024 * 1024;

/**
 * Demo limits. The 25,000-row figure is provisional; a measured fictional workbook of that size
 * was a 2.5 MiB file with 20 MiB of sheet XML. See docs/architecture.md for what the limits do
 * and do not bound.
 */
export const DEFAULT_INPUT_LIMITS: InputLimits = {
  maxFileBytes: 4 * MiB,
  maxArchiveEntries: 100,
  maxEntryUncompressedBytes: 24 * MiB,
  maxTotalUncompressedBytes: 32 * MiB,
  maxMergedCells: 1_000,
  maxWorkbookCells: 1_500_000,
  maxDataRows: 25_000,
  maxColumns: 40,
};

export function resolveInputLimits(overrides: Partial<InputLimits> = {}): InputLimits {
  const limits = { ...DEFAULT_INPUT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`limits.${name} must be a positive integer`);
    }
  }
  return limits;
}
