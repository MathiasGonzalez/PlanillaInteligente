declare module 'xlsx-populate' {
  export interface Cell {
    value(): unknown;
    value(nextValue: unknown): Cell;
    value(nextValue: unknown[][]): Cell;
    formula(): string | undefined;
  }

  export interface Range {
    value(): unknown;
  }

  export interface Sheet {
    name(): string;
    cell(row: number, column: number): Cell;
    usedRange(): Range | undefined;
  }

  export interface Workbook {
    sheets(): Sheet[];
    sheet(sheetNameOrIndex: string | number): Sheet | undefined;
    addSheet(name: string): Sheet;
    outputAsync(
      typeOrOptions?: 'uint8array' | 'arraybuffer' | 'blob' | { type?: 'uint8array' | 'arraybuffer' | 'blob' },
    ): Promise<Uint8Array | ArrayBuffer | Blob>;
  }

  export interface XlsxPopulateStatic {
    fromDataAsync(data: ArrayBuffer | Uint8Array | Blob | Promise<unknown>): Promise<Workbook>;
    fromBlankAsync(): Promise<Workbook>;
  }

  const XlsxPopulate: XlsxPopulateStatic;
  export default XlsxPopulate;
}
