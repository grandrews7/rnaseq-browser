import { useEffect, useRef, useState } from "react";
import {
  GenomeBrowser,
  bigWigModule,
  createBrowserStore,
  createTrackStore,
  transcriptModule,
  type AnyTrackInstance,
} from "@weng-lab/genomebrowser";

import { junctionModule } from "./junctionModule";

import {
  ASSEMBLY,
  CANONICAL_COLOR,
  GENCODE_VERSION,
  GENE_TRACK_DISPLAY,
  GENE_TRACK_HEIGHT,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_GENE,
  INITIAL_REGION,
  SHOW_GENE_TRACK,
  TRACKS,
} from "./config";

const MARGIN_WIDTH = 150;

/**
 * Stores are Zustand hooks and MUST be created once, outside of render.
 * Recreating them resets the region, the tracks, and all in-flight requests.
 */
const useBrowserStore = createBrowserStore({
  region: INITIAL_REGION,
  marginWidth: MARGIN_WIDTH,
  trackWidth: 900,
});

const signalTracks: AnyTrackInstance[] = TRACKS.map((track) =>
  bigWigModule.create({
    id: track.id,
    title: track.title,
    display: "full",
    height: track.height ?? 60,
    color: track.color ?? "#2266aa",
    config: {
      url: track.url,
      fillWithZero: true,
      ...(track.yRange ? { yRange: track.yRange } : {}),
    },
  }),
);

const geneTrack = transcriptModule.create({
  id: "genes",
  title: "GENCODE",
  display: GENE_TRACK_DISPLAY,
  height: GENE_TRACK_HEIGHT,
  config: {
    assembly: ASSEMBLY,
    version: GENCODE_VERSION,
    canonicalColor: CANONICAL_COLOR,
    highlightColor: HIGHLIGHT_COLOR,
    ...(HIGHLIGHT_GENE ? { geneName: HIGHLIGHT_GENE } : {}),
  },
});

const junctionTrack = junctionModule.create({
  id: "risdiplam-1um-rep1-jxn",
  title: "Risdiplam 1µM rep1 — junctions",
  height: 100,
  config: {
    url: "/junctions/smn_region.json",
    minCount: 3,
    sample: "Exp1_risdiplam_1um_rep1",
  },
});

const useTrackStore = createTrackStore({
  modules: [bigWigModule, transcriptModule, junctionModule],
  tracks: SHOW_GENE_TRACK
    ? [geneTrack, junctionTrack, ...signalTracks]
    : [junctionTrack, ...signalTracks],
});
/**
 * Make pasted coordinates parseable. Papers, genome browsers, and macOS
 * smart-dashes all produce en/em dashes and thin spaces that the region
 * parser rejects, e.g. "chr12:120,978,543–121,002,512".
 */
const normalizeRegion = (value: string) =>
  value
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-") // any dash → hyphen
    .replace(/[\s\u00A0\u2000-\u200B,_]/g, "") // spaces, commas, underscores
    .replace(/\.\.+/g, "-") // "chr12:1..500" style
    .trim();

function formatRegion(r: { chromosome: string; start: number; end: number }) {
  return `${r.chromosome}:${r.start.toLocaleString()}-${r.end.toLocaleString()}`;
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const region = useBrowserStore((state) => state.region);
  const setRegion = useBrowserStore((state) => state.setRegion);
  const zoom = useBrowserStore((state) => state.zoom);

  const [draft, setDraft] = useState(INITIAL_REGION);
  const [error, setError] = useState<string | null>(null);

  // The browser never measures its own parent — we have to tell it the width.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const trackWidth = Math.max(1, entry.contentRect.width - MARGIN_WIDTH);
      useBrowserStore.getState().setTrackWidth(trackWidth);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const go = () => {
    try {
      setRegion(normalizeRegion(draft));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid region");
    }
  };

  const pan = (fraction: number) => {
    const span = region.end - region.start;
    const shift = Math.round(span * fraction);
    const start = Math.max(0, region.start + shift);
    setRegion({ chromosome: region.chromosome, start, end: start + span });
  };

  return (
    <main>
      <header>
        <h1>RNA-seq tracks</h1>
        <div className="controls">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && go()}
            placeholder="chr12:6,534,517-6,538,374 "
            spellCheck={false}
          />
          <button onClick={go}>Go</button>
          <span className="spacer" />
          <button onClick={() => pan(-0.5)} title="Pan left">
            &larr;
          </button>
          <button onClick={() => zoom(0.5)} title="Zoom in">
            +
          </button>
          <button onClick={() => zoom(2)} title="Zoom out">
            &minus;
          </button>
          <button onClick={() => pan(0.5)} title="Pan right">
            &rarr;
          </button>
        </div>
        <p className="readout">
          {formatRegion(region)}{" "}
          <span className="dim">
            ({(region.end - region.start).toLocaleString()} bp)
          </span>
        </p>
        {error && <p className="error">{error}</p>}
      </header>

      <div ref={containerRef} className="browser">
        <GenomeBrowser browserStore={useBrowserStore} trackStore={useTrackStore} />
      </div>
    </main>
  );
}
