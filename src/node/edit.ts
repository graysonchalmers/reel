// Clip edits from the live viewer: reorder or delete a trailer's clips by rewriting the trailer
// file's source text. Each clip's `loc` (file:line:col of its shot()/title() call) finds the call;
// a small scanner finds its closing paren. Only trailers whose clips are separate top-level calls
// with nothing but commas, whitespace and comments between them can be edited this way.

export class EditError extends Error {}

/** Offset of 1-based line/col in src. */
function offsetOf(src: string, line: number, col: number): number {
  let off = 0;
  for (let l = 1; l < line; l++) {
    const nl = src.indexOf("\n", off);
    if (nl < 0) return -1;
    off = nl + 1;
  }
  return off + col - 1;
}

/** End offset (exclusive) of the call starting at `start` (`name(...)`), skipping strings and comments. */
function callEnd(src: string, start: number): number {
  const m = /^[A-Za-z_$][\w$]*\s*\(/.exec(src.slice(start));
  if (!m) return -1;
  let depth = 0;
  for (let i = start + m[0].length - 1; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; if (i <= 0) return -1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

const GAP = /^\s*,(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*$/;

/** Source spans of each clip, or why the trailer can't be edited. `file` is the trailer's basename. */
export function clipSpans(src: string, file: string, locs: (string | undefined)[]): { spans: [number, number][] } | { why: string } {
  const spans: [number, number][] = [];
  for (const loc of locs) {
    const m = loc && /^(.*):(\d+):(\d+)$/.exec(loc);
    if (!m || m[1] !== file) return { why: "a clip comes from another file or has no location" };
    const a = offsetOf(src, Number(m[2]), Number(m[3])), b = a < 0 ? -1 : callEnd(src, a);
    if (b < 0) return { why: `can't find the call at ${loc}` };
    spans.push([a, b]);
  }
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] < spans[i - 1][1]) return { why: "clips are made in a loop or helper" };
    if (!GAP.test(src.slice(spans[i - 1][1], spans[i][0]))) return { why: "clips are not plain sibling calls" };
  }
  return { spans };
}

/** New source with the clips in `order` (indexes into the current clips; missing ones are deleted). */
export function reorderClips(src: string, file: string, locs: (string | undefined)[], order: number[]): string {
  const r = clipSpans(src, file, locs);
  if ("why" in r) throw new EditError(r.why);
  const { spans } = r;
  if (!order.length) throw new EditError("a trailer needs at least one clip");
  if (new Set(order).size !== order.length || order.some((i) => !Number.isInteger(i) || i < 0 || i >= spans.length))
    throw new EditError("bad clip order");
  const gaps = spans.slice(1).map(([a], i) => src.slice(spans[i][1], a));
  let body = "";
  order.forEach((k, j) => { body += (j ? gaps[j - 1] : "") + src.slice(spans[k][0], spans[k][1]); });
  return src.slice(0, spans[0][0]) + body + src.slice(spans[spans.length - 1][1]);
}
