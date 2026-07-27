import { z } from "zod";
import { BigWigReader, AxiosDataLoader } from "genomic-reader";
import {
  defineTrackModule,
  fetchOnChange,
  type TrackRenderer,
} from "@weng-lab/genomebrowser";

/**
 * dynseq track (after Kundaje et al.): a per-base bigWig (phyloP, model
 * importance scores, ...) shown as a filled signal when zoomed out, and as
 * colored nucleotide LETTERS scaled by score when zoomed in — negatives below
 * the axis.
 *
 * The glyph shapes are the weng-lab LogoJS nucleotide paths (100x100 box),
 * extracted and rendered directly here as React-19-native SVG. (logojs-react's
 * own components are built against React 16 and don't render under React 19, so
 * we reuse only the letter geometry, not its React wrapper.)
 *
 * Needs two files: the scores bigWig and a genome 2bit, both range-read.
 * Switch to letters is screen-adaptive via pixels-per-base.
 */

// LogoJS glyph geometry (weng-lab/logojs-package), each in a 100x100 box.
const GLYPHS: Record<string, { d: string; fill?: string }[]> = {
  A: [
    { d: "M 0 100 L 33 0 L 66 0 L 100 100 L 75 100 L 66 75 L 33 75 L 25 100 L 0 100" },
    { d: "M 41 55 L 50 25 L 58 55 L 41 55", fill: "#ffffff" },
  ],
  C: [{ d: "M 100 28 C 100 -13 0 -13 0 50 C 0 113 100 113 100 72 L 75 72 C 75 90 30 90 30 50 C 30 10 75 10 75 28 L 100 28" }],
  G: [{ d: "M 100 28 C 100 -13 0 -13 0 50 C 0 113 100 113 100 72 L 100 48 L 55 48 L 55 72 L 75 72 C 75 90 30 90 30 50 C 30 10 75 5 75 28 L 100 28" }],
  T: [{ d: "M 0 0 L 0 20 L 35 20 L 35 100 L 65 100 L 65 20 L 100 20 L 100 0 L 0 0" }],
};

// Base colors from LogoJS DNAAlphabet.
const BASE_COLOR: Record<string, string> = {
  A: "red",
  C: "blue",
  G: "orange",
  T: "#228b22",
};

type DynseqDatum = { position: number; score: number; base: string };
type Data = DynseqDatum[];

const configSchema = z.object({
  bigwigUrl: fetchOnChange(z.string().min(1)),
  twoBitUrl: fetchOnChange(z.string().min(1)),
  minPixelsPerBase: z.number().default(7),
  maxLetterBases: z.number().default(1000),
  // Coordinate seam between the bigWig scores and the 2bit sequence.
  // genomic-reader's loadSequence() subtracts 1 from the requested start
  // internally (TwoBitHeaderReader: `start = start - 1`), so the returned
  // string begins one base BEFORE region.start. We therefore index the
  // sequence at (p - region.start + 1) to realign letters with their scores.
  // Verified against the Zoonomia CTCF motif (chr10:73,879,829 C-core).
  // Exposed as a knob in case a future genomic-reader version removes that -1.
  seqOffset: z.number().default(1),
  posColor: z.string().default("#3a6ea5"),
});

type Config = z.infer<typeof configSchema>;

const bwCache = new Map<string, BigWigReader>();
function getReader(url: string): BigWigReader {
  let r = bwCache.get(url);
  if (!r) {
    r = new BigWigReader(new AxiosDataLoader(url));
    bwCache.set(url, r);
  }
  return r;
}

/** One nucleotide glyph, scaled into a cell of the given pixel width/height,
 *  flipped below the baseline for negative scores. */
function Glyph({
  base,
  x,
  cellW,
  pxHeight,
  baseline,
  negative,
}: {
  base: string;
  x: number;
  cellW: number;
  pxHeight: number;
  baseline: number;
  negative: boolean;
}) {
  const paths = GLYPHS[base];
  if (!paths || pxHeight <= 0) return null;
  const color = BASE_COLOR[base] ?? "#666";
  // Glyph is 100x100. Scale x by cellW/100, y by pxHeight/100.
  // Positive: sits above baseline, growing up. Negative: below, flipped.
  const sx = cellW / 100;
  const sy = pxHeight / 100;
  // Glyph box: y=0 letter-top, y=100 letter-bottom, upright, positive sy keeps
  // it upright. Positive score: letter sits ABOVE baseline, so its top is at
  // (baseline - pxHeight) and it extends down to baseline. Negative: letter
  // hangs BELOW, top at baseline extending down to (baseline + pxHeight).
  const topY = negative ? baseline : baseline - pxHeight;
  const transform = `translate(${x}, ${topY}) scale(${sx}, ${sy})`;
  return (
    <g transform={transform}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ?? color} />
      ))}
    </g>
  );
}

const DynseqRenderer: TrackRenderer<Config, Data> = ({
  config,
  data,
  region,
  width,
  height,
}) => {
  if (data.length === 0) return null;

  const bases = region.end - region.start;
  const pixelsPerBase = width / Math.max(1, bases);
  const showLetters =
    pixelsPerBase >= config.minPixelsPerBase && bases <= config.maxLetterBases;

  const scores = data.map((d) => d.score);
  const maxAbs = Math.max(1e-6, ...scores.map((s) => Math.abs(s)));
  const mid = height / 2;
  const toX = (pos: number) => ((pos - region.start) / bases) * width;

  if (!showLetters) {
    // Filled signal area with a zero-line; negatives below.
    let d = `M ${toX(region.start)} ${mid}`;
    for (const pt of data) {
      const x = toX(pt.position);
      const y = mid - (pt.score / maxAbs) * (height / 2);
      d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    d += ` L ${toX(region.end)} ${mid} Z`;
    return (
      <>
        <line x1={0} y1={mid} x2={width} y2={mid} stroke="#ccc" strokeWidth={0.5} />
        <path d={d} fill={config.posColor} opacity={0.8} />
        <text x={2} y={10} fontSize={10} fill="#666">
          {maxAbs.toFixed(2)}
        </text>
      </>
    );
  }

  // Letter mode: one glyph per base, height scaled by |score|/maxAbs.
  const cellW = width / data.length;
  const halfH = height / 2;
  return (
    <>
      <line x1={0} y1={mid} x2={width} y2={mid} stroke="#ccc" strokeWidth={0.5} />
      {data.map((pt, i) => {
        const base = pt.base.toUpperCase();
        if (!GLYPHS[base]) return null;
        const pxHeight = (Math.abs(pt.score) / maxAbs) * halfH;
        return (
          <Glyph
            key={i}
            base={base}
            x={toX(pt.position)}
            cellW={cellW}
            pxHeight={pxHeight}
            baseline={mid}
            negative={pt.score < 0}
          />
        );
      })}
    </>
  );
};

export const dynseqModule = defineTrackModule<DynseqDatum>()({
  type: "dynseq",
  defaults: { height: 100 },
  configSchema,
  async fetch({ config, region }): Promise<Data> {
    const bw = getReader(config.bigwigUrl);
    const twoBit = getReader(config.twoBitUrl);
    const [scoreData, seq] = await Promise.all([
      bw.readBigWigData(region.chromosome, region.start, region.chromosome, region.end),
      twoBit.readTwoBitData(region.chromosome, region.start, region.end),
    ]);
    const out: Data = [];
    for (const iv of scoreData) {
      for (let p = iv.start; p < iv.end; p++) {
        const i = p - region.start + config.seqOffset;
        if (i < 0 || i >= seq.length) continue;
        out.push({ position: p, score: iv.value, base: seq[i] });
      }
    }
    return out;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: { full: DynseqRenderer as any },
  tooltipComponent: ({ item }) => (
    <text>
      {item.base} · {item.score.toFixed(3)}
    </text>
  ),
});
