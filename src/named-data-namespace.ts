/** Canonical namespace syntax shared with the Named Data contract. */
export const NAMED_DATA_NAMESPACE_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u;

export function isNamedDataNamespace(value: unknown): value is string {
  return typeof value === 'string' && NAMED_DATA_NAMESPACE_PATTERN.test(value);
}
