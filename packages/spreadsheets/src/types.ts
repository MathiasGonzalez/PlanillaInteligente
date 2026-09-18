export type SpreadsheetColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json';

export interface ParsedSpreadsheetSummary {
  sheetName: string;
  columnsCount: number;
  rowsCount: number;
}
