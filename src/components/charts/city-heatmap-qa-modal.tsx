"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { CityPlaceQaReport } from "@/lib/city-heatmap-qa";
import type { CityKey } from "@/lib/geo/city-config";
import { CITIES } from "@/lib/geo/city-config";
import type { CityPlaceQaFinding, CityPlaceQaFindingKind } from "@/lib/geo/city-place-qa";

// The in-app version of #293's diagnostic script (see
// src/lib/geo/city-place-qa.ts for what each kind means): a summary of
// every place whose coordinates disagree with its declared neighborhood,
// with the four things you'd want to do about one — dismiss it as
// intended, jump to its place editor (where saving the address re-runs
// the geocode, see /api/places/[id]), or fix a *naming* gap with a
// custom neighborhood -> polygon mapping that also corrects the heatmap's
// own colouring (see cityNeighborhoodOverrides).

const KIND_ORDER: CityPlaceQaFindingKind[] = ["mismatch", "outside", "spelling", "unmapped"];

const KIND_COPY: Record<CityPlaceQaFindingKind, { title: string; blurb: string }> = {
  mismatch: {
    title: "Wrong neighborhood",
    blurb: "The catalog says one neighborhood, but the coordinates land in a different one. Most likely a bad coordinate.",
  },
  outside: {
    title: "Outside the city",
    blurb: "The catalog names a neighborhood, but the coordinates land in none of this city's polygons. Badly off, or a real geometry gap.",
  },
  spelling: {
    title: "Spelling differs",
    blurb: "Not a coordinate problem: the catalog name is the same neighborhood as the polygon the point is in, spelled differently. Map it below.",
  },
  unmapped: {
    title: "No matching polygon name",
    blurb: "The catalog's name doesn't match any polygon, but the point does land in one. Often a genuine naming gap; map it if the polygon is right.",
  },
};

export function CityHeatmapQaModal({
  open,
  onClose,
  cityKey,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  cityKey: CityKey;
  /** Called after any change that can affect the heatmap's own
   * colouring (adding/removing a mapping), so the page can refetch. */
  onChanged: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`${CITIES[cityKey].label}: place coordinate check`} wide>
      {/* The body owns the fetch and its state, so it is mounted only while
          the modal is open: closing throws the report away, and reopening
          (or switching city) always starts from a fresh check. */}
      <QaBody cityKey={cityKey} onChanged={onChanged} />
    </Modal>
  );
}

function QaBody({ cityKey, onChanged }: { cityKey: CityKey; onChanged: () => void }) {
  const [report, setReport] = useState<CityPlaceQaReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  // Bumped after every mutation to re-run the check. The previous report
  // stays on screen until the new one lands, so a dismiss doesn't blank
  // the list.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/city-heatmap-qa?city=${encodeURIComponent(cityKey)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Failed to load");
        if (!cancelled) {
          setReport(body as CityPlaceQaReport);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [cityKey, version]);

  async function send(url: string, method: "POST" | "DELETE", payload: unknown, affectsChart: boolean) {
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(typeof body?.error === "string" ? body.error : "Request failed");
        return;
      }
      setVersion((v) => v + 1);
      if (affectsChart) onChanged();
    } catch {
      setError("Network error");
    }
  }

  const dismiss = (f: CityPlaceQaFinding) =>
    send("/api/city-heatmap-qa/dismissals", "POST", { placeId: f.placeId, kind: f.kind }, false);
  const restore = (f: CityPlaceQaFinding) =>
    send("/api/city-heatmap-qa/dismissals", "DELETE", { placeId: f.placeId, kind: f.kind }, false);
  const addMapping = (root: string, rawName: string, geometryName: string) =>
    send("/api/city-heatmap-qa/overrides", "POST", { cityKey, root, rawName, geometryName }, true);
  const removeMapping = (root: string, rawName: string) =>
    send("/api/city-heatmap-qa/overrides", "DELETE", { cityKey, root, rawName }, true);

  const openCount = report?.open.length ?? 0;

  return (
    <div className="flex flex-col gap-5 text-sm">
      <p className="text-xs text-muted-foreground">
        Checks each geocoded place against the neighborhood its catalog hierarchy says it is in. The map colours by that
        hierarchy, so a wrong coordinate only shows up as a misplaced dot.
      </p>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!report && !error ? <p className="text-xs text-muted-foreground">Checking…</p> : null}

      {report ? (
        <>
          {openCount === 0 ? <p className="text-xs text-muted-foreground">Nothing to review.</p> : null}

          {KIND_ORDER.map((kind) => {
            const rows = report.open.filter((f) => f.kind === kind);
            if (rows.length === 0) return null;
            return (
              <section key={kind} className="flex flex-col gap-2">
                <div>
                  <h3 className="font-medium">
                    {KIND_COPY[kind].title} <span className="text-muted-foreground">({rows.length})</span>
                  </h3>
                  <p className="text-xs text-muted-foreground">{KIND_COPY[kind].blurb}</p>
                </div>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {rows.map((f) => (
                    <FindingRow key={`${f.placeId}:${f.kind}`} finding={f} report={report} onDismiss={dismiss} onMap={addMapping} />
                  ))}
                </ul>
              </section>
            );
          })}

          {report.overrides.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="font-medium">
                Custom mappings <span className="text-muted-foreground">({report.overrides.length})</span>
              </h3>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {report.overrides.map((o) => (
                  <li key={`${o.root}:${o.rawName}`} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <span>
                      <span className="font-medium">{o.rawName}</span> <span className="text-muted-foreground">({o.root}) →</span>{" "}
                      {o.geometryName}
                    </span>
                    <Button type="button" variant="ghost" size="xs" onClick={() => removeMapping(o.root, o.rawName)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {report.dismissed.length > 0 ? (
            <section className="flex flex-col gap-2">
              <button
                type="button"
                className="self-start text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowDismissed((v) => !v)}
              >
                {showDismissed ? "Hide" : "Show"} dismissed ({report.dismissed.length})
              </button>
              {showDismissed ? (
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {report.dismissed.map((f) => (
                    <li key={`${f.placeId}:${f.kind}`} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <span>
                        {f.placeName} <span className="text-muted-foreground">({KIND_COPY[f.kind].title})</span>
                      </span>
                      <Button type="button" variant="ghost" size="xs" onClick={() => restore(f)}>
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function FindingRow({
  finding,
  report,
  onDismiss,
  onMap,
}: {
  finding: CityPlaceQaFinding;
  report: CityPlaceQaReport;
  onDismiss: (f: CityPlaceQaFinding) => void;
  onMap: (root: string, rawName: string, geometryName: string) => void;
}) {
  const [mapping, setMapping] = useState(false);
  // A naming fix only makes sense where the point landed in a polygon
  // (`actual`) but the name didn't resolve to it — mismatch/outside are
  // coordinate problems, fixed in the place editor instead.
  const canMap = (finding.kind === "spelling" || finding.kind === "unmapped") && finding.actual !== null;

  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{finding.placeName}</div>
          <div className="truncate text-xs text-muted-foreground">{finding.namePath}</div>
          <div className="mt-1 text-xs">
            {finding.declared ? (
              <span>
                Catalog: <span className="font-medium">{finding.declared.featureName}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Catalog name matches no polygon</span>
            )}
            {" · "}
            {finding.actual ? (
              <span>
                Point is in: <span className="font-medium">{finding.actual.name}</span>
              </span>
            ) : (
              <span>Point is in none of this city&apos;s polygons</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <a
            href={`/manage/places/${finding.placeId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-xs hover:bg-muted"
          >
            Edit place
          </a>
          {canMap ? (
            <Button type="button" variant="outline" size="xs" onClick={() => setMapping((v) => !v)}>
              Map name
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="xs" onClick={() => onDismiss(finding)}>
            Dismiss
          </Button>
        </div>
      </div>
      {mapping && finding.actual ? (
        <MapForm finding={finding} report={report} onMap={(root, raw, geo) => { onMap(root, raw, geo); setMapping(false); }} />
      ) : null}
    </li>
  );
}

function MapForm({
  finding,
  report,
  onMap,
}: {
  finding: CityPlaceQaFinding;
  report: CityPlaceQaReport;
  onMap: (root: string, rawName: string, geometryName: string) => void;
}) {
  const actual = finding.actual!;
  const segments = finding.namePath.split("/").filter(Boolean);
  const prefill = finding.suggestedAlias?.segment ?? segments[segments.length - 1] ?? "";
  const [segment, setSegment] = useState(prefill);
  const polygons = report.geometryNames.find((g) => g.root === actual.root)?.names ?? [];
  const [polygon, setPolygon] = useState(actual.name);

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-2 text-xs">
      <label className="flex min-w-40 flex-1 flex-col gap-1">
        <span className="text-muted-foreground">Catalog name</span>
        <Select value={segment} onChange={(e) => setSegment(e.target.value)} className="h-8 text-xs">
          {segments.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1">
        <span className="text-muted-foreground">Polygon ({actual.root})</span>
        <Select value={polygon} onChange={(e) => setPolygon(e.target.value)} className="h-8 text-xs">
          {polygons.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </label>
      <Button type="button" size="xs" onClick={() => onMap(actual.root, segment, polygon)}>
        Save mapping
      </Button>
    </div>
  );
}
