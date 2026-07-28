import { useEffect, useRef, useState } from "react";
import {
  GenomeBrowser,
  createBrowserStore,
  createTrackStore,
  transcriptModule,
} from "@weng-lab/genomebrowser";

import { dynseqModule } from "./dynseqModule";

import {
  ASSEMBLY,
  CANONICAL_COLOR,
  GENCODE_VERSION,
  GENE_TRACK_DISPLAY,
  GENE_TRACK_HEIGHT,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_GENE,
  SHOW_GENE_TRACK,
} from "./config";

const MARGIN_WIDTH = 150;

// Start narrow so the dynseq track is in LETTER mode immediately (needs ~7+
// pixels/base). ~150 bp over a ~900px track ≈ 6px/base; zoom in one notch to
// cross into letters. This window is SMN2 exon 7.
const TEST_REGION = "chr5:70076000-70076150";

const useBrowserStore = createBrowserStore({
  region: TEST_REGION,
  marginWidth: MARGIN_WIDTH,
  trackWidth: 900,
});

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

const dynseqTrack = dynseqModule.create({
  id: "zoonomia-phylop-dynseq",
  title: "Zoonomia 241 phyloP — dynseq",
  height: 120,
  config: {
    bigwigUrl: "https://users.wenglab.org/andrewsg/241-mammalian-2020v2.bigWig",
    twoBitUrl: "https://users.wenglab.org/andrewsg/browser/hg38.2bit",
  },
});

const useTrackStore = createTrackStore({
  modules: [transcriptModule, dynseqModule],
  tracks: SHOW_GENE_TRACK ? [geneTrack, dynseqTrack] : [dynseqTrack],
});

const normalizeRegion = (value: string) =>
  value
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\s\u00A0\u2000-\u200B,_]/g, "")
    .replace(/\.\.+/g, "-")
    .trim();

function formatRegion(r: { chromosome: string; start: number; end: number }) {
  return `${r.chromosome}:${r.start.toLocaleString()}-${r.end.toLocaleString()}`;
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const region = useBrowserStore((state) => state.region);
  const setRegion = useBrowserStore((state) => state.setRegion);
  const zoom = useBrowserStore((state) => state.zoom);

  const [draft, setDraft] = useState(TEST_REGION);
  const [error, setError] = useState<string | null>(null);

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
        <h1>dynseq test</h1>
        <div className="controls">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && go()}
            placeholder="chr5:70,076,000-70,076,150"
            spellCheck={false}
          />
          <button onClick={go}>Go</button>
          <span className="spacer" />
          <button onClick={() => pan(-0.5)} title="Pan left">&larr;</button>
          <button onClick={() => zoom(0.5)} title="Zoom in">+</button>
          <button onClick={() => zoom(2)} title="Zoom out">&minus;</button>
          <button onClick={() => pan(0.5)} title="Pan right">&rarr;</button>
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
