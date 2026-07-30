import { useEffect, useRef, useState } from "react";
import {
  GenomeBrowser,
  bigWigModule,
  createBrowserStore,
  createTrackStore,
  transcriptModule,
} from "@weng-lab/genomebrowser";

import { bamModule } from "./bamModule";
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
const BASE = "https://users.wenglab.org/andrewsg/browser";

// HNF1A — liver master-regulator TF, snappy in HepG2. hg38 gene:
// chr12:120,978,543-121,002,512 (~24kb).
const TEST_REGION = "chr12:120978000-121003000";

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

// HepG2 RNA-seq from BAM (coverage default; reads/sashimi on zoom).
const rnaTrack = bamModule.create({
  id: "hepg2-rna-bam",
  title: "HepG2 RNA-seq (ENCFF660EXG)",
  height: 180,
  config: {
    bamUrl: `${BASE}/ENCFF660EXG.bam`,
    display: "coverage",
    coverageMaxBases: 100000,
    maxBases: 100000,
    sashimiMaxBases: 100000,
  },
});

// DNase accessibility — observed signal (ENCFF160DXJ) and ChromBPNet
// bias-corrected predicted profile (ENCFF264HQR). Observed vs predicted is a QC:
// agreement = faithful model.
const dnaseObserved = bigWigModule.create({
  id: "dnase-observed",
  title: "HepG2 DNase — observed (ENCFF160DXJ)",
  display: "full",
  height: 60,
  color: "#2a7a2a",
  config: { url: `${BASE}/ENCFF160DXJ.bigWig`, fillWithZero: true },
});

const dnasePredicted = bigWigModule.create({
  id: "dnase-predicted",
  title: "HepG2 DNase — ChromBPNet predicted (ENCFF264HQR)",
  display: "full",
  height: 60,
  color: "#6a3d9a",
  config: { url: `${BASE}/ENCFF264HQR.bigWig`, fillWithZero: true },
});

// ChromBPNet counts contribution scores (dynseq: signal wide, motif letters in).
const dynseqContrib = dynseqModule.create({
  id: "dynseq-chrombpnet",
  title: "ChromBPNet contribution (ENCFF829DSC)",
  height: 110,
  config: {
    bigwigUrl: `${BASE}/ENCFF829DSC.bigWig`,
    twoBitUrl: `${BASE}/hg38.2bit`,
  },
});

// ISM (in silico mutagenesis) importance — the model's output change when each
// base is mutated. A different (more direct) attribution than contribution
// scores. Two models: ChromBPNet and Cherimoya, for a methods comparison.
const dynseqIsmChrombpnet = dynseqModule.create({
  id: "dynseq-ism-chrombpnet",
  title: "ChromBPNet ISM (HNF1A)",
  height: 110,
  config: {
    bigwigUrl: `${BASE}/hnf1a_chrombpnet_ism.bw`,
    twoBitUrl: `${BASE}/hg38.2bit`,
  },
});

const dynseqIsmCherimoya = dynseqModule.create({
  id: "dynseq-ism-cherimoya",
  title: "Cherimoya ISM (HNF1A)",
  height: 110,
  config: {
    bigwigUrl: `${BASE}/hnf1a_cherimoya_ism.bw`,
    twoBitUrl: `${BASE}/hg38.2bit`,
  },
});

// phyloP dynseq — evolutionary QC against the contribution scores.
const dynseqPhyloP = dynseqModule.create({
  id: "dynseq-phylop",
  title: "Zoonomia phyloP (QC)",
  height: 100,
  config: {
    bigwigUrl: "https://users.wenglab.org/andrewsg/241-mammalian-2020v2.bigWig",
    twoBitUrl: `${BASE}/hg38.2bit`,
  },
});

const useTrackStore = createTrackStore({
  modules: [transcriptModule, bigWigModule, bamModule, dynseqModule],
  tracks: SHOW_GENE_TRACK
    ? [geneTrack, rnaTrack, dnaseObserved, dnasePredicted, dynseqContrib, dynseqIsmChrombpnet, dynseqIsmCherimoya, dynseqPhyloP]
    : [rnaTrack, dnaseObserved, dnasePredicted, dynseqContrib, dynseqIsmChrombpnet, dynseqIsmCherimoya, dynseqPhyloP],
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
        <h1>HepG2 multi-omic — HNF1A</h1>
        <div className="controls">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && go()}
            placeholder="chr12:120,978,000-121,003,000"
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
