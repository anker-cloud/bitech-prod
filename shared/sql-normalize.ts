const GERMAN_CHAR_REPLACEMENTS: [string, string][] = [
  ['ä', 'a'],
  ['ö', 'o'],
  ['ü', 'u'],
  ['Ä', 'A'],
  ['Ö', 'O'],
  ['Ü', 'U'],
  ['ß', 'ss'],
];

export function normalizeGermanExpr(expr: string): string {
  let result = `CAST(${expr} AS VARCHAR)`;
  for (const [from, to] of GERMAN_CHAR_REPLACEMENTS) {
    result = `REPLACE(${result}, '${from}', '${to}')`;
  }
  return `LOWER(${result})`;
}

export function normalizeGermanValue(value: string): string {
  let result = value;
  for (const [from, to] of GERMAN_CHAR_REPLACEMENTS) {
    result = result.replace(new RegExp(from, 'g'), to);
  }
  return result.toLowerCase();
}

export function isStringFilterOperator(op: string): boolean {
  return ['equals', 'not_equals', 'contains', 'not_contains', 'in'].includes(op);
}
