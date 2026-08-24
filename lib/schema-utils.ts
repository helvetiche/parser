/**
 * Shared coercion helpers used by the candidate and role schema
 * normalizers to turn arbitrary model output into well-typed shapes.
 */

export function objectFromUnknown(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  // Some models wrap the payload in a single-element array.
  if (Array.isArray(input) && input[0] && typeof input[0] === "object") {
    return input[0] as Record<string, unknown>;
  }
  return {};
}

export function toText(value: unknown): string {
  if (value == null) return "N/A";
  if (typeof value === "string") return value.trim() || "N/A";
  return String(value);
}

export function toList(value: unknown, delimiter: RegExp): string[] {
  const parts = Array.isArray(value)
    ? value.map((item) => String(item))
    : typeof value === "string"
      ? value.split(delimiter)
      : value != null
        ? [String(value)]
        : [];
  return parts.map((part) => part.trim()).filter(Boolean);
}
