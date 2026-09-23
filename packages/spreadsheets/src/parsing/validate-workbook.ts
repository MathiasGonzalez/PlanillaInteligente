const ZIP_LOCAL_HEADER = [0x50, 0x4b];

export const MAX_XLSX_BYTES = 10 * 1024 * 1024;
export const MAX_XLSX_COLUMNS = 200;
export const MAX_XLSX_ROWS = 10_000;
export const MAX_XLSX_SHEETS = 10;

export class WorkbookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookValidationError';
  }
}

export function assertXlsxContainer(buffer: ArrayBuffer) {
  if (buffer.byteLength === 0) {
    throw new WorkbookValidationError('The uploaded file is empty.');
  }

  if (buffer.byteLength > MAX_XLSX_BYTES) {
    throw new WorkbookValidationError('The workbook exceeds the 10 MB size limit.');
  }

  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === ZIP_LOCAL_HEADER[0]
    && bytes[1] === ZIP_LOCAL_HEADER[1]
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
  if (!isZip) {
    throw new WorkbookValidationError('The file is not a valid .xlsx workbook.');
  }

  const payload = new TextDecoder('latin1').decode(bytes);
  if (!payload.includes('[Content_Types].xml')) {
    throw new WorkbookValidationError('The file is not a valid .xlsx workbook.');
  }
}

export function assertWorkbookShape(columnCount: number, rowCount: number) {
  if (columnCount > MAX_XLSX_COLUMNS) {
    throw new WorkbookValidationError(`The workbook exceeds the limit of ${MAX_XLSX_COLUMNS} columns.`);
  }

  if (rowCount > MAX_XLSX_ROWS) {
    throw new WorkbookValidationError(`The workbook exceeds the limit of ${MAX_XLSX_ROWS} rows.`);
  }
}
