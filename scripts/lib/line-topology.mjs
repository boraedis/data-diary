import { topology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";
import { quantize } from "topojson-client";

/**
 * Helpers shared by the city overlay builds (scripts/geo-build-roads.mjs,
 * scripts/geo-build-transit.mjs): joining a network's segments into
 * polylines, and simplifying the result until it fits a per-city size
 * budget. Their reasoning is in the roads build's header (#631).
 */

export const nodeKey = ([x, y]) => `${x},${y}`;

/**
 * Joins lines end to end wherever exactly two of them meet, so a road that
 * Overture cut into one segment per block comes out as one polyline.
 *
 * This is what makes simplification work at all. topojson treats every
 * line's endpoints as junctions that no later pass may remove, so a network
 * of per-block segments keeps at least two vertices per segment however
 * hard it's simplified: Atlanta's roads were 1.2MB at 0.8% of points
 * kept, because there was almost nothing left to remove. Chained, a
 * highway is one arc and its vertices are fair game. A node where three or
 * more lines meet (a real intersection) is left as a break, so the network's
 * shape isn't altered, only its bookkeeping.
 */
export function chainLines(lines) {
  const ends = new Map(); // node -> [{ line index, which end }]
  lines.forEach((line, i) => {
    for (const [end, pt] of [
      [0, line[0]],
      [1, line[line.length - 1]],
    ]) {
      const key = nodeKey(pt);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push({ i, end });
    }
  });
  const used = new Array(lines.length).fill(false);
  const out = [];
  for (let start = 0; start < lines.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    let chain = lines[start].slice();
    for (const direction of ["forward", "backward"]) {
      for (;;) {
        const tip = direction === "forward" ? chain[chain.length - 1] : chain[0];
        const next = findPartnerOfChain(tip);
        if (!next) break;
        used[next.i] = true;
        // Orient the neighbour so it leaves `tip`.
        const line = lines[next.i];
        const leaving = nodeKey(line[0]) === nodeKey(tip) ? line : line.slice().reverse();
        chain = direction === "forward" ? chain.concat(leaving.slice(1)) : leaving.slice().reverse().concat(chain.slice(1));
      }
    }
    out.push(chain);
  }
  return out;

  // A chain's tip belongs to its latest segment, not `start`, so the lookup
  // is by node, not by the line that started the chain.
  function findPartnerOfChain(tip) {
    const here = ends.get(nodeKey(tip));
    if (!here || here.length !== 2) return null;
    const open = here.filter((e) => !used[e.i]);
    return open.length === 1 ? open[0] : null;
  }
}

/** Simplifies until the serialized topology fits `target`: the same loop as
 * the water's, without its polygon-inversion guard (a line has no inside to
 * invert). Goes further down than water does, since a dense street grid is
 * mostly near-collinear vertices. */
export function buildTopology(features, target, objectName) {
  const base = presimplify(topology({ [objectName]: { type: "FeatureCollection", features } }, 1e6));
  let json = "";
  let kept = 1;
  for (const p of [1, 0.5, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05, 0.035, 0.025, 0.018, 0.012, 0.008]) {
    const minWeight = p === 1 ? 0 : quantile(base, p);
    const topo = quantize(simplify(structuredClone(base), minWeight), 1e5);
    json = JSON.stringify(topo);
    kept = p;
    if (json.length <= target) break;
  }
  if (json.length > target) console.warn(`    over the ${target / 1000}KB target even at ${kept * 100}% of points kept`);
  return { json, kept };
}
