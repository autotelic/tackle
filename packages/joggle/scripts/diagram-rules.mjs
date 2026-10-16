// Generates docs/rule-anatomy.svg — how joggle's two kinds of rules work.
// Run with: node scripts/diagram-rules.mjs
import { writeFileSync } from "node:fs"

const W = 1500, H = 1108
const SANS = "ui-sans-serif,-apple-system,'Segoe UI',Inter,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace"
const PAPER = "#fbfaf6", INK = "#1a1914", MUTED = "#6f6c62", RULE = "#d8d4c8"
const DET = "#0f6f5c", JUD = "#a8480c", OUT = "#3a4a8c", CODE = "#2b2a24", SOFT = "#f1eee6"

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const t = (x, y, s, { size = 14, w = 400, fill = INK, anchor = "start", mono = false, ls = 0, op = 1 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${mono ? MONO : SANS}" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${ls}" opacity="${op}">${esc(s)}</text>`
const box = (x, y, w, h, { fill = "none", stroke = RULE, sw = 1.2, rx = 12 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const pill = (x, y, w, h, { fill = "none", stroke = RULE } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`

// arrow with dashed "flow" class
const arrow = (x1, y1, x2, y2, color = MUTED, cls = "flow") => {
  const mx = (x1 + x2) / 2
  return `<path class="${cls}" d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="1.6" marker-end="url(#a-${color.replace("#", "")})"/>`
}

const p = []
p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="How joggle's rules work">`)
p.push(`<defs>`)
for (const c of [MUTED, DET, JUD, OUT]) {
  p.push(`<marker id="a-${c.replace("#", "")}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="${c}"/></marker>`)
}
p.push(`<style>
.flow{stroke-dasharray:7 6;animation:flow 1.1s linear infinite}
@keyframes flow{to{stroke-dashoffset:-13}}
.pulse{animation:pulse 2.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.flow,.pulse{animation:none}}
</style>`)
p.push(`</defs>`)
p.push(box(0, 0, W, H, { fill: PAPER, stroke: PAPER, rx: 0 }))

// ── header ──────────────────────────────────────────────────────────────
p.push(t(64, 80, "How joggle decides", { size: 36, w: 700 }))
p.push(t(64, 112, "One kind of rule: a candidate generator, and a question.  Be deterministic where you can prove, and judge only where you must.", { size: 16, fill: MUTED }))
p.push(`<line x1="64" y1="136" x2="${W - 64}" y2="136" stroke="${RULE}" stroke-width="1.2"/>`)

// ── where it sits ───────────────────────────────────────────────────────
const chips = [
  ["tsc / tsgo", "the program  ·  is this well-typed?"],
  ["oxlint", "the file and its AST  ·  is this well-formed?"],
  ["joggle", "the codebase and its facts  ·  is this the same thing as that?"],
]
chips.forEach(([name, sub], i) => {
  const x = 64 + i * 460, y = 154, w = 440, h = 56
  const on = i === 2
  p.push(box(x, y, w, h, { fill: on ? SOFT : "none", stroke: on ? INK : RULE, sw: on ? 1.6 : 1.2 }))
  p.push(t(x + 18, y + 25, name, { size: 16, w: 700, fill: on ? INK : MUTED }))
  p.push(t(x + 18, y + 44, sub, { size: 12.5, fill: MUTED }))
})

// ── the index ───────────────────────────────────────────────────────────
p.push(box(64, 236, W - 128, 116, { fill: "#ffffff", stroke: RULE }))
p.push(t(86, 266, "1 · THE INDEX", { size: 15, w: 700, ls: 0.6 }))
p.push(t(W - 86, 266, "deterministic · content-addressed · cached", { size: 12, fill: MUTED, anchor: "end" }))
p.push(t(86, 296, "oxc parse  →  units · imports · call sites · jsx · object literals · columns", { size: 13.5, mono: true, fill: CODE }))
p.push(t(86, 318, "tsgo  →  types", { size: 13.5, mono: true, fill: CODE }))
p.push(t(86, 340, "an unchanged run costs nothing: the index is reused", { size: 12, fill: MUTED }))

// ── the rule ────────────────────────────────────────────────────────────
const LY = 392, LH = 396
const DX = 64, DW = W - 128

p.push(box(DX, LY, DW, LH, { fill: "#ffffff", stroke: JUD, sw: 1.4 }))
p.push(`<rect x="${DX}" y="${LY}" width="${DW}" height="6" rx="3" fill="${JUD}"/>`)
p.push(t(DX + 22, LY + 40, "2 · A RULE", { size: 15.5, w: 700, fill: JUD, ls: 0.4 }))
p.push(t(DX + DW - 22, LY + 40, "generation is deterministic · the verdict is a question", { size: 12, fill: JUD, anchor: "end", mono: true }))
p.push(t(DX + 22, LY + 66, "Every rule is judged. The deterministic half is its find: a predicate over the facts, free and high recall.", { size: 12.5, fill: MUTED, w: 900 }))

const moves = [
  ["1  find", "a predicate over the facts · high recall · noise tolerated"],
  ["2  evidence", "the panel a reviewer would need · bounded atoms"],
  ["3  questions", "atomic and typed:  Noul · Choice · Score"],
  ["4  policy", "the gates you control, in one file"],
  ["5  diagnose", "span · message · help · confidence"],
]
moves.forEach(([k, v], i) => {
  const x = DX + 30 + i * ((DW - 60) / 5)
  p.push(t(x, LY + 118, k, { size: 14, w: 700, fill: JUD }))
  p.push(t(x, LY + 142, v, { size: 12.5, fill: INK, w: (DW - 60) / 5 - 20 }))
})

const prim = LY + 208
p.push(t(DX + 30, prim, "Noul: is it true? (0–1)      Choice: one of a set      Score: a level on a rubric", { size: 12.5, fill: MUTED, w: 900 }))

const bx = LY + 228
p.push(box(DX + 30, bx, DW - 60, 34, { fill: SOFT, stroke: JUD }))
p.push(t(DX + 30 + (DW - 60) / 2, bx + 22, "every rule's questions for a run travel in ONE request", { size: 13, w: 600, anchor: "middle", fill: JUD }))

const gy = LY + 272
p.push(box(DX + 30, gy, DW - 60, 58, { fill: "none", stroke: RULE }))
p.push(t(DX + 46, gy + 23, "gates", { size: 12, w: 700, fill: MUTED, ls: 0.6 }))
p.push(t(DX + 104, gy + 23, "probabilityFloor 0.5  ·  minMargin 0.25  ·  reviewFloor 0.6", { size: 13, mono: true, fill: CODE }))
p.push(t(DX + 46, gy + 44, "below the floor: drop      ·      uncertain: a notice      ·      decisive: a finding", { size: 12.5, fill: MUTED }))

p.push(t(DX + 30, LY + LH - 18, "a rule with no model key is skipped, unless --offline replays its cached answers", { size: 12, fill: JUD }))

// ── connectors ──────────────────────────────────────────────────────────
p.push(arrow(W / 2, 352, W / 2, LY, JUD))

// ── outcome ─────────────────────────────────────────────────────────────
const OY = 824, OH = 140
p.push(box(64, OY, W - 128, OH, { fill: "#ffffff", stroke: OUT, sw: 1.4 }))
p.push(`<rect x="64" y="${OY}" width="${W - 128}" height="6" rx="3" fill="${OUT}"/>`)
p.push(t(86, OY + 42, "3 · THE OUTCOME", { size: 15.5, w: 700, fill: OUT, ls: 0.4 }))
p.push(t(W - 86, OY + 42, "text · stylish · unix · json · github", { size: 12.5, mono: true, fill: MUTED, anchor: "end" }))
const outs = [
  [86, "DIAGNOSTICS", "one diagnostic shape — span · severity · message · help · confidence"],
  [546, "NOTES", "the census, and every bound the run hit"],
  [1006, "DROPS", "the funnel: no_evidence · budget · declined · gated · unreadable"],
]
for (const [x, head, body] of outs) {
  p.push(t(x, OY + 76, head, { size: 12.5, w: 700, fill: MUTED, ls: 0.8 }))
  p.push(t(x, OY + 100, body, { size: 12.5, fill: INK }))
}
p.push(arrow(W / 2, LY + LH, W / 2, OY, JUD))

// ── replay / scope ──────────────────────────────────────────────────────
const RY = 992
p.push(box(64, RY, W - 128, 84, { fill: SOFT, stroke: RULE }))
p.push(t(86, RY + 32, "REPLAY", { size: 11.5, w: 700, fill: MUTED, ls: 1 }))
p.push(t(86, RY + 58, "key = question version + model + evidence + questions", { size: 13, mono: true, fill: CODE }))
p.push(t(700, RY + 58, "commit .joggle/answers/  →  CI replays --offline with no key", { size: 13, fill: INK }))
p.push(t(W - 86, RY + 32, "SCOPE", { size: 11.5, w: 700, fill: MUTED, ls: 1, anchor: "end" }))
p.push(t(W - 86, RY + 58, "changed · since <rev> · pr · all", { size: 13, mono: true, fill: CODE, anchor: "end" }))

p.push(t(64, H - 18, "joggle — docs/rule-anatomy.svg", { size: 11.5, fill: MUTED }))
p.push(`</svg>`)

const svg = p.join("\n") + "\n"

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>joggle — how its rules decide</title>
<style>
  :root { --paper:#fbfaf6; --ink:#1a1914; --muted:#6f6c62; --rule:#d8d4c8; --card:#ffffff; }
  @media (prefers-color-scheme: dark) { :root { --paper:#14130f; --ink:#f2efe6; --muted:#9a968a; --rule:#332f27; --card:#0f0e0b; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font:16px/1.6 ui-sans-serif,-apple-system,'Segoe UI',Inter,sans-serif; -webkit-font-smoothing:antialiased; }
  main { max-width:1560px; margin:0 auto; padding:40px 24px 72px; }
  h1 { font-size:28px; margin:0 0 6px; letter-spacing:-0.01em; }
  p.lede { color:var(--muted); margin:0 0 28px; max-width:88ch; }
  .frame { border:1px solid var(--rule); border-radius:14px; overflow:hidden; background:var(--card); }
  .frame svg { display:block; width:100%; height:auto; }
  .legend { display:flex; gap:40px; flex-wrap:wrap; margin-top:26px; }
  .legend > div { flex:1 1 360px; }
  .legend h2 { font-size:12.5px; text-transform:uppercase; letter-spacing:.09em; color:var(--muted); margin:0 0 6px; }
  .legend p { margin:0; }
  footer { margin-top:30px; color:var(--muted); font-size:14px; }
  a { color:inherit; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.92em; }
</style>
</head>
<body>
<main>
  <h1>How joggle decides</h1>
  <p class="lede">Two kinds of rule, one report. <strong>Deterministic</strong> rules are a predicate over the facts and never call a model. <strong>Judged</strong> rules ask atomic typed questions about the candidates the code cannot decide by looking. The long version is <a href="../JOGGLE.md">JOGGLE.md</a>.</p>
  <div class="frame">
${svg}  </div>
  <div class="legend">
    <div>
      <h2>Deterministic — a predicate</h2>
      <p>Facts in, diagnostic out. Always runs, even with no key and no network. <code>layer-direction</code>, <code>import-cycle</code>, <code>field-type-drift</code>, <code>nullability-drift</code>, <code>object-shape</code>.</p>
    </div>
    <div>
      <h2>Judged — a question</h2>
      <p>High-recall candidates become evidence, then atomic questions, then gates. Every rule's questions travel in one request. <code>duplicate-meaning</code>, <code>naming-drift</code>, <code>hoist-to-domain</code>, <code>data-error-as-outage</code>.</p>
    </div>
  </div>
  <footer>Generated by <code>scripts/diagram-rules.mjs</code> &middot; the raw artwork is <a href="./rule-anatomy.svg">rule-anatomy.svg</a> &middot; regenerate with <code>pnpm diagram:rules</code>.</footer>
</main>
</body>
</html>
`

writeFileSync(new URL("../docs/rule-anatomy.svg", import.meta.url), svg)
writeFileSync(new URL("../docs/rule-anatomy.html", import.meta.url), html)
console.log("wrote docs/rule-anatomy.svg", svg.length, "bytes and docs/rule-anatomy.html", html.length, "bytes")
