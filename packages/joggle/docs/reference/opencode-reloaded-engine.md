# The anoma.ly notes engine, reconstructed

A reverse-engineering note on the interactive diagrams in
[OpenCode Reloaded](https://anoma.ly/notes/opencode-reloaded/) by Kit Langton.
Nothing here is official; it is read off the shipped bundle and the live DOM.

## What it is

A bespoke **publication** framework, shipped as a Vite + React SPA under
`/notes`. There is no package and no source map: the public surface is two
functions and a contract of `data-*` attributes.

```
startPublication(root)        reader-Dqk0mqbe.js
  -> justify [data-justice-static] with @kitlangton/justice
  -> mark "article:published-text"
  -> requestAnimationFrame x2, then dynamically import client
mountArticle(root, hydrate)   client-DLI4n8Qn.js
  -> react-dom createRoot | hydrateRoot, StrictMode
```

The article is data. `route-D-xcm4UR.js` carries `{slug, heading, lines,
summary, date, source, diagramIds}` — ten diagram ids for this piece.

## The content model

The article is authored as an outline, not as markup. In the bundle:

```
[{ id: "opening", title: "Opening", beats: [
    { id: "pleasure", title: "The pleasure of hot reloading",
      description: "Start with the pleasure of not having to reload.",
      status: "completed",
      blocks: [{ id: "intro-pleasures", kind: "draft" }] },
    { id: "promise", ..., blocks: [
        { id: "intro-hot", kind: "prose" },
        { id: "config-power-opening", kind: "diagram" } ] } ] }]
```

So: sections → **beats** → **blocks**, where a block is `draft | prose |
diagram`. The same outline drives the writing workflow and the page.

## The subsystems

| Subsystem | Contract | Notes |
| --- | --- | --- |
| Reader chrome | `data-route`, `data-reader-heading`, `data-article-chrome`, `data-article-entrance`, `data-article-theme-control`, `data-article-sound-control` | theme applied pre-paint from `notes:theme`; sound is a separate control |
| Typesetter | `data-typesetter`, `data-line-id`, `data-line-container-id`, `data-measure-line-id`, `data-measure-exclude` | measures rendered prose lines into `measuredBox`, then places diagrams/annotations by `placement` + `precedence` (collision resolution). `measureLineElsById`, `getMeasureLineElement`, `MeasureLayout`, `alwaysMeasureLayout`, `needsMeasurement` |
| Scene | `data-article-diagram`, `data-scene-*` | a scene is a sequence of `beats`/`steps`: `stepLength`, `pendingStep`, `playbackState`, `autoplay`, `playthrough`, `replay`, `seek`, `gate`, `held`, `arm`, `settle`, `dim`, `palette`, `controls`, `play-overlay`, `play-blur`, `corner-anchor`, `sceneLimitMs` |
| Narration | `data-narration-id`, `data-narration-word`, `data-narration-ink`, `-heat`, `-focus`, `-highlight`, `-cue`, `-current`, `-step`, `-text`, `-hud`, `-component`, `-control` | the article prose IS the track: paragraphs split into word spans, and the scene **inks** words as it plays. `inkOnly` inks without the graphics |
| Effects | `data-vhs-shader`, class `vhs-rewind`, `feDisplacementMap` | a `Vhs({settings, reduced, bleed, inkOnly, children})` component wrapping children in an SVG filter, honouring `prefers-reduced-motion`; plus a **WGSL/WebGPU raymarch shader** (`vec3f`, `transmittance`, interleaved-gradient-noise) |
| Motion | Framer Motion internals: `attachTimeline`, `measureViewportBox`, `measureInstanceViewportBox`, `popLayout`, motion values | scroll/`AnimationTimeline`-linked animation; `ResizeObserver` for layout, `IntersectionObserver` to gate playback |
| Typography | `data-justice-static`, `data-justice-id` | `@kitlangton/justice` justification, with a copy handler that restores plain text |
| State | `state-4Ro5WIwm.js` | a `Map<id, {element, dispose}>` registry plus a `Float64Array`-aware JSON codec (`{f64:[...]}`) |

## Does it match a public project?

No. Evidence:

- no source map (`*.js.map` -> 404); no repo or npm package link in the bundle;
- no repo named `notes`/`publication`/`narration`/`scene`/`reader` under
  `anomalyco` (81 public repos) or `kitlangton`; GitHub search
  `scene+beats+narration` -> 0 results; npm `@kitlangton` (38 packages) has no
  scene engine; web search for the `data-*` hooks finds nothing.

The ingredients are public, though: React, Motion, and Kit's own
`@kitlangton/justice` (used here), `animated-code`, `rolling-number`,
`cuelume`. OpenCode itself is `anomalyco/opencode`, MIT.

Conceptually adjacent, but not matches:

| Project | Why it is close | Why it is not it |
| --- | --- | --- |
| Idyll (MIT) | explorable explanations, interactive essays | different authoring model (markup), no narration/beats |
| Motion Canvas (MIT) | scene + generator, stepwise animation | canvas, no prose track, no typesetter |
| Theatre.js (Apache-2.0) | scenes, sequences, a studio | animates objects, not article text |
| Remotion | React-authored sequences, timelines | renders video |
| scrollama | `IntersectionObserver` scrollytelling stepping | no scenes, no narration inking |
| rough-notation (MIT) | animates annotations on words | static annotation, not synchronized playback |
| floating-ui (MIT) | placement/anchoring of positioned elements | interactive positioning, not text-line measurement |

The unmatched part is the combination: a **typesetter** that measures prose lines
and places diagrams against them with precedence, a **narration ink** that plays
the article's own words as a synchronized track, and a **beats/blocks** outline
that authors both. That trio is the novel bit, and it is not a known library.
