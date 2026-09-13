declare module 'xlsx-populate' {
  export interface Cell {
    value(): unknown;
    value(nextValue: unknown): Cell;
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
    sheet(sheetNameOrIndex: string | number): Sheet | undefined;
    outputAsync(
      typeOrOptions?: 'uint8array' | 'arraybuffer' | 'blob' | { type?: 'uint8array' | 'arraybuffer' | 'blob' },
    ): Promise<Uint8Array | ArrayBuffer | Blob>;
  }

  export interface XlsxPopulateStatic {
    fromDataAsync(data: ArrayBuffer | Uint8Array | Blob | Promise<unknown>): Promise<Workbook>;
  }

  const XlsxPopulate: XlsxPopulateStatic;
  export default XlsxPopulate;
}
