const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type OptionalHexColorResult = { ok: true; value: string | null } | { ok: false };

export function parseOptionalHexColor(value: unknown): OptionalHexColorResult {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: true, value: null };
  }
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}
