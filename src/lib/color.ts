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

type HexColorResult = { ok: true; value: string } | { ok: false };

// Required variant, for savedColors.hex (issue #45) — unlike every other
// color column in this schema, a saved-palette entry with no color at all
// doesn't mean anything, so empty/missing is rejected here instead of
// coming back as a valid `null`.
export function parseHexColor(value: unknown): HexColorResult {
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}
