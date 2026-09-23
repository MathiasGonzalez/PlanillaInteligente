const SENSITIVE = /(password|secret|token|api[_ -]?key|clave|dni|rut|cuit|ssn|card|tarjeta)/i;
const SPECIAL = /(salud|diagn[oó]st|enfermedad|medic|obra[\s_-]?social|religi[oó]n|religios|iglesia|pol[ií]tic|partido|sindicat|gremio|sexual|orientaci[oó]n[\s_-]?sexual|raza|etnia|[eé]tnico|discapacidad|biom[eé]tr)/i;

export function isSensitiveName(key: string, label = '') {
  return SENSITIVE.test(key) || SENSITIVE.test(label);
}

export function isSpecialName(key: string, label = '') {
  return SPECIAL.test(key) || SPECIAL.test(label);
}

export function isRestrictedName(key: string, label = '') {
  return isSensitiveName(key, label) || isSpecialName(key, label);
}

export function restrictedFieldKeys(fields: Array<{ key: string; label?: string; sensitive?: boolean; specialCategory?: boolean }>) {
  return fields
    .filter((field) => field.sensitive || field.specialCategory || isRestrictedName(field.key, field.label ?? ''))
    .map((field) => field.key);
}

export function redactRestrictedData(
  fields: Array<{ key: string; label?: string; sensitive?: boolean; specialCategory?: boolean }>,
  data: Record<string, unknown>,
) {
  const blocked = new Set(restrictedFieldKeys(fields));
  if (blocked.size === 0) return data;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!blocked.has(key)) next[key] = value;
  }
  return next;
}

export function previewSample(
  fields: Array<{ key: string; label?: string; sensitive?: boolean; specialCategory?: boolean }>,
  data: Record<string, unknown>,
) {
  return JSON.stringify(redactRestrictedData(fields, data)).slice(0, 180);
}
