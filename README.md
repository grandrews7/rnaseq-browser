# RNA-seq browser starter

A minimal Vite + React app that embeds `@weng-lab/genomebrowser` v2 and renders
a stack of RNA-seq coverage tracks with a gene annotation track on top.

## Run it

```sh
npm install
npm run dev
```

Then open the printed localhost URL. Verified against
`@weng-lab/genomebrowser@2.0.0-alpha.1`, React 19.2, Vite 7, Node 22.

## Point it at your data

Edit `src/config.ts` — that's the only file you need to touch. Set
`INITIAL_REGION` and replace each `REPLACE_WITH_YOUR_BIGWIG_URL` with a URL to
one of your RNA-seq bigWigs. Add or delete entries in `TRACKS` freely; each one
becomes a row.

## Things that will bite you

**Install the alpha explicitly.** `npm install @weng-lab/genomebrowser` resolves
to the `latest` tag, which is still `1.8.7` — a different API. The v2 line is
published under the `alpha` tag. Pin the exact version as this project does.

**bigWig URLs need Range requests and CORS.** The browser fetches byte ranges
rather than whole files. A static host must allow `Range` in
`Access-Control-Allow-Headers` and expose `Content-Range`. If tracks stay empty
and the network tab shows failed or opaque requests, this is why. Easiest
workaround while prototyping: drop the files in `public/` and reference them as
`/sample.bw`, which makes them same-origin.

**Chromosome naming has to match the bigWig.** `chr1` vs `1` is a common cause
of a silently empty track. Check with `bigWigInfo -chroms yourfile.bw`.

**Set `yRange` when comparing samples.** Without a fixed y-axis each track
autoscales independently, which makes eyeballed comparisons between samples
meaningless. The starter fixes it at 0–50; adjust to your depth.

**The gene track needs a GraphQL endpoint.** `transcriptModule` POSTs to
`/api/screen-graphql`. `vite.config.ts` proxies that path to a Weng Lab SCREEN
GraphQL service — **confirm the correct upstream URL with Jair**, since it isn't
recorded in the repo. If you don't need gene models yet, set
`SHOW_GENE_TRACK = false` in `src/config.ts` and the app runs standalone.

**The browser does not measure its own container.** You must feed it a
`trackWidth`. `App.tsx` does this with a `ResizeObserver`; if you restructure
the layout, keep that wiring or the browser renders blank or clipped.

**Create the stores once, outside render.** `createBrowserStore` and
`createTrackStore` return Zustand hooks. Calling them inside a component resets
region, tracks, and in-flight requests on every render.

**Benign build warnings.** Vite reports that `stream` and `fs` were externalized
from `genomic-reader`. Those are Node-only code paths that aren't hit in the
browser; the build succeeds and the app runs.

## Where the real documentation lives

The published docs ship inside the repo rather than on a site:

- `packages/core/docs/gettingStarted.md`
- `packages/core/docs/tracks.md` — every built-in module and its config
- `packages/core/docs/concepts.md` — lifecycle and request semantics
- `packages/core/docs/recipes.md` — add/remove/reorder/update tracks
- `packages/core/docs/troubleshooting.md`
- `packages/ui/docs/` — the optional `@weng-lab/genomebrowser-ui` package

Note that the UI package peers on `@mui/x-data-grid-premium` and `@mui/x-license`,
which are commercially licensed. You do not need it for this use case.
# rnaseq-browser
