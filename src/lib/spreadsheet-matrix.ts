export function toMatrix(value: unknown): unknown[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  if (value.length === 0) {
    return [];
  }

  return Array.isArray(value[0]) ? (value as unknown[][]) : [value as unknown[]];
}
