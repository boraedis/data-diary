/**
 * jsdom implements SVG elements only as far as the DOM tree — it doesn't
 * implement the SVG geometry properties (`svg.width.baseVal.value`), which
 * on a real browser mirror the width/height attributes as animated lengths.
 *
 * d3-zoom reads exactly those in its `defaultExtent`, to decide what area a
 * gesture is allowed to pan within. Under jsdom that read throws
 * "Cannot read properties of undefined (reading 'baseVal')" — asynchronously,
 * from inside a d3-transition tick, so it surfaces as an *unhandled error*
 * that vitest reports separately from any test rather than failing one. That
 * makes it worse than a plain failure: the suite stays green while carrying
 * an error that could just as easily be hiding a real one.
 *
 * This shim gives those two properties the shape d3-zoom expects, reading
 * from the element's own attributes (which the charts do set, via
 * `.attr("width", ...)`). It's not an SVG implementation — just enough for
 * a zoom behavior to compute an extent without throwing.
 *
 * Installed once from vitest.setup.ts rather than per-test, and never torn
 * down, which is the whole reason it lives here instead of in a
 * `beforeEach`: the zoom it serves runs inside a 600ms d3 transition that
 * routinely outlives the test that started it. An `afterEach` that removed
 * this would restore jsdom's own (missing) properties *before* the timer
 * fires, and the error would come back — exactly what happened on the
 * first attempt.
 */
function animatedLengthFromAttribute(el: Element, attribute: string) {
  return { baseVal: { value: Number(el.getAttribute(attribute)) || 0 } };
}

export function installSvgGeometryShim() {
  // Guarded: the same setup file runs for node-environment tests, where
  // there's no DOM and no SVGSVGElement to patch.
  if (typeof SVGSVGElement === "undefined") return;
  const proto = SVGSVGElement.prototype;
  if (Object.getOwnPropertyDescriptor(proto, "width")) return;
  Object.defineProperties(proto, {
    width: {
      configurable: true,
      get(this: Element) {
        return animatedLengthFromAttribute(this, "width");
      },
    },
    height: {
      configurable: true,
      get(this: Element) {
        return animatedLengthFromAttribute(this, "height");
      },
    },
  });
}
