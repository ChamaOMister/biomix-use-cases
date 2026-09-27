/**
 * ExcelJS's internal address decoder (exceljs 4.4.0, pinned). The structure pre-scan uses it so
 * that range sizes are computed exactly as ExcelJS computes them while loading.
 */
declare module "exceljs/lib/utils/col-cache.js" {
  interface DecodedReference {
    top?: number;
    left?: number;
    bottom?: number;
    right?: number;
    row?: number;
    col?: number;
    sheetName?: string;
    error?: string;
  }
  const colCache: {
    decodeAddress(value: string): { row?: number; col?: number };
    decodeEx(value: string): DecodedReference;
  };
  export default colCache;
}
