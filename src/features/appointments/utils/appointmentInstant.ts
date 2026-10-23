// Compare zoned whole seconds, then fractions without Date's millisecond truncation.
// Shared unchanged BF141 comparison; schemas keep their six-schema public API.
export function appointmentInstantPrecedes(from: string, to: string): boolean {
  const fraction = /\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/;
  const fromSecond = Date.parse(from.replace(fraction, ''));
  const toSecond = Date.parse(to.replace(fraction, ''));
  if (fromSecond !== toSecond) return fromSecond < toSecond;
  const fromFraction = from.match(fraction)?.[1] ?? '';
  const toFraction = to.match(fraction)?.[1] ?? '';
  const length = Math.max(fromFraction.length, toFraction.length);
  return fromFraction.padEnd(length, '0') < toFraction.padEnd(length, '0');
}
