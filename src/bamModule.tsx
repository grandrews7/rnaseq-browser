import { z } from "zod";
import { BamReader, AxiosDataLoader, type BamAlignment } from "genomic-reader";
import {
  defineTrackModule,
  fetchOnChange,
  useTooltip,
  type TrackRenderer,
  type TrackSettingsProps,
  SettingsSection,
} from "@weng-lab/genomebrowser";

/**
 * BAM track: coverage and/or read pileup, both derived on the fly from the
 * alignments in view. BAM is the sole data source (no precomputed bigWig/bigBed),
 * so everything is zoom-gated: above maxBases we skip the (heavy) read fetch.
 *
 * display modes:
 *   "coverage" (default) — histogram of per-base depth, computed from CIGAR
 *   "pileup"             — stacked reads (IGV-style)
 *   "both"               — coverage on top, reads below
 */

const configSchema = z.object({
  bamUrl: fetchOnChange(z.string().min(1)),
  baiUrl: z.string().optional(),
  display: z.enum(["coverage", "pileup", "both", "sashimi"]).default("coverage"),
  // Coverage is derived from the BAM by reading every alignment in the window,
  // then binning. genomic-reader's read() has no limit/downsample hook, so the
  // whole window's reads materialize in memory — on a very dense gene (e.g. ALB
  // in HepG2) a wide window can exhaust the tab. This cap is the safe ceiling
  // for pure-BAM coverage; beyond it we show "zoom in" rather than attempt the
  // fetch. Raise it only if your BAMs aren't deeply covered.
  coverageMaxBases: z.number().default(25000),  // coverage/signal zoom gate (BAM read volume bound)
  maxBases: z.number().default(20000),          // pileup zoom gate (tight)
  sashimiMaxBases: z.number().default(100000),  // sashimi zoom gate
  maxSpan: z.number().default(30000),          // drop paralog-crossing arcs
  minMapq: z.number().default(1),              // 0 drops multi-mappers (MAPQ 0)
  maxReads: z.number().default(400),
  color: z.string().default("#5b8bd0"),
  minusColor: z.string().default("#d08b5b"),
  coverageColor: z.string().default("#3a6ea5"),
});

type Config = z.infer<typeof configSchema>;
type Data = BamAlignment[];

const readerCache = new Map<string, BamReader>();
function getReader(bamUrl: string, baiUrl: string): BamReader {
  let reader = readerCache.get(bamUrl);
  if (!reader) {
    reader = new BamReader(new AxiosDataLoader(bamUrl), new AxiosDataLoader(baiUrl));
    readerCache.set(bamUrl, reader);
  }
  return reader;
}

/** Per-base coverage over [start,end) from CIGAR M/=/X ops (N and D skip). */
/**
 * Per-BIN coverage over [start,end), binned to `nBins` (≈ pixel columns).
 * Uses a difference array: each aligned segment contributes two O(1) updates
 * (not one-per-base), so cost is O(reads × cigarOps + nBins) instead of
 * O(total aligned bases). This keeps coverage fast even over a wide window on a
 * very highly-expressed gene (e.g. ALB in HepG2), while still counting every
 * read — no downsampling, so the depth is exact at bin resolution.
 * N (splice) and D (deletion) advance the reference without adding depth.
 */
function computeBinnedCoverage(
  reads: BamAlignment[],
  start: number,
  end: number,
  nBins: number,
): number[] {
  const span = Math.max(1, end - start);
  const binOf = (pos: number) =>
    Math.min(nBins - 1, Math.max(0, Math.floor(((pos - start) / span) * nBins)));
  // diff[i] += d means "depth rises by d starting at bin i"; prefix-sum later.
  const diff = new Float64Array(nBins + 1);
  for (const r of reads) {
    let ref = r.start;
    for (const c of r.cigarOps) {
      if (c.op === "M" || c.op === "=" || c.op === "X") {
        const segStart = ref;
        const segEnd = ref + c.opLen;
        if (segEnd > start && segStart < end) {
          const b0 = binOf(segStart);
          const b1 = binOf(segEnd - 1);
          diff[b0] += 1;
          diff[b1 + 1] -= 1;
        }
        ref += c.opLen;
      } else if (c.op === "N" || c.op === "D") {
        ref += c.opLen;
      }
    }
  }
  const cov = new Array<number>(nBins).fill(0);
  let running = 0;
  for (let i = 0; i < nBins; i++) {
    running += diff[i];
    cov[i] = running;
  }
  return cov;
}

/** Splice junctions (N gaps) tallied from reads currently in view.
 *  Counts are view-local: exact for the visible window, not genome-wide. */
function junctionsFromReads(
  reads: BamAlignment[],
): { start: number; end: number; count: number }[] {
  const tally = new Map<string, number>();
  for (const r of reads) {
    let ref = r.start;
    for (const c of r.cigarOps) {
      if (c.op === "M" || c.op === "=" || c.op === "X" || c.op === "D") {
        ref += c.opLen;
      } else if (c.op === "N") {
        const key = `${ref}-${ref + c.opLen}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
        ref += c.opLen;
      }
    }
  }
  return [...tally.entries()].map(([k, count]) => {
    const [start, end] = k.split("-").map(Number);
    return { start, end, count };
  });
}

/** Greedy row-packing for pileup. */
function packRows(reads: BamAlignment[], gap: number): number[] {
  const rowEnds: number[] = [];
  const rowOf: number[] = [];
  for (const read of reads) {
    const end = read.start + read.lengthOnRef;
    let placed = -1;
    for (let r = 0; r < rowEnds.length; r++) {
      if (read.start > rowEnds[r] + gap) {
        placed = r;
        break;
      }
    }
    if (placed === -1) {
      placed = rowEnds.length;
      rowEnds.push(end);
    } else {
      rowEnds[placed] = end;
    }
    rowOf.push(placed);
  }
  return rowOf;
}

function CoverageArea({
  reads,
  region,
  width,
  height,
  color,
}: {
  reads: BamAlignment[];
  region: { start: number; end: number };
  width: number;
  height: number;
  color: string;
}) {
  const bases = region.end - region.start;
  // One bin per pixel column: compute coverage at display resolution, so the
  // cost scales with pixels (~width), not with the genomic span.
  const nBins = Math.max(1, Math.min(2000, Math.floor(width)));
  const cov = computeBinnedCoverage(reads, region.start, region.end, nBins);
  const max = Math.max(1, ...cov);
  let d = `M 0 ${height}`;
  for (let i = 0; i < nBins; i++) {
    const x = (i / nBins) * width;
    const y = height - (cov[i] / max) * height;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L ${width} ${height} Z`;
  return (
    <>
      <path d={d} fill={color} opacity={0.85} />
      <text x={2} y={10} fontSize={10} fill="#666">
        {max}
      </text>
    </>
  );
}

function Pileup({
  reads,
  region,
  width,
  height,
  config,
  tooltip,
}: {
  reads: BamAlignment[];
  region: { start: number; end: number };
  width: number;
  height: number;
  config: Config;
  tooltip: ReturnType<typeof useTooltip<BamAlignment, Config>>;
}) {
  const bases = region.end - region.start;
  const toX = (pos: number) => ((pos - region.start) / bases) * width;
  // If more reads than the cap, sample EVENLY across the region rather than
  // taking the first N (which come back sorted by start and would all cluster
  // on the left, hiding reads under the rest of the coverage).
  const capped =
    reads.length <= config.maxReads
      ? reads
      : reads.filter(
          (_, i) => i % Math.ceil(reads.length / config.maxReads) === 0,
        );
  const rowOf = packRows(capped, 2);
  const rowCount = Math.max(1, ...rowOf.map((r) => r + 1));
  const rowH = Math.max(2, Math.min(10, (height - 2) / rowCount));
  const readH = Math.max(1, rowH - 1);

  return (
    <>
      {capped.map((read, i) => {
        const y = rowOf[i] * rowH;
        const color = read.strand ? config.color : config.minusColor;
        const segs: React.ReactNode[] = [];
        let ref = read.start;
        read.cigarOps.forEach((c, k) => {
          if (c.op === "M" || c.op === "=" || c.op === "X") {
            const x = toX(ref);
            const w = Math.max(0.5, toX(ref + c.opLen) - x);
            segs.push(<rect key={k} x={x} y={y} width={w} height={readH} fill={color} />);
            ref += c.opLen;
          } else if (c.op === "N") {
            segs.push(
              <line
                key={k}
                x1={toX(ref)}
                y1={y + readH / 2}
                x2={toX(ref + c.opLen)}
                y2={y + readH / 2}
                stroke="#bbb"
                strokeWidth={1}
              />,
            );
            ref += c.opLen;
          } else if (c.op === "D") {
            ref += c.opLen;
          }
        });
        return (
          <g
            key={read.readName + i}
            onMouseEnter={(e) => tooltip.show(read, e)}
            onMouseLeave={tooltip.hide}
            style={{ cursor: "pointer" }}
          >
            {segs}
          </g>
        );
      })}
      {capped.length < reads.length && (
        <text x={2} y={height - 2} fontSize={10} fill="#999">
          showing {capped.length} of {reads.length} reads
        </text>
      )}
    </>
  );
}

function Sashimi({
  reads,
  region,
  width,
  height,
  color,
  maxSpan,
}: {
  reads: BamAlignment[];
  region: { start: number; end: number };
  width: number;
  height: number;
  color: string;
  maxSpan: number;
}) {
  const bases = region.end - region.start;
  const toX = (pos: number) => ((pos - region.start) / bases) * width;
  const junctions = junctionsFromReads(reads).filter(
    (j) =>
      j.end >= region.start &&
      j.start <= region.end &&
      j.end - j.start <= maxSpan,
  );
  if (junctions.length === 0) return null;
  const maxCount = Math.max(...junctions.map((j) => j.count));
  const baseline = height - 2;
  const apexY = 12;
  const stroke = (c: number) => 0.75 + (Math.log1p(c) / Math.log1p(maxCount)) * 3.25;
  return (
    <>
      {junctions.map((j) => {
        const x1 = toX(j.start);
        const x2 = toX(j.end);
        const midX = (x1 + x2) / 2;
        return (
          <g key={`${j.start}-${j.end}`}>
            <path
              d={`M ${x1} ${baseline} Q ${midX} ${apexY} ${x2} ${baseline}`}
              fill="none"
              stroke={color}
              strokeWidth={stroke(j.count)}
              opacity={0.85}
            />
            <text x={midX} y={apexY - 2} textAnchor="middle" fontSize={10} fill={color}>
              {j.count}
            </text>
          </g>
        );
      })}
    </>
  );
}

const BamRenderer: TrackRenderer<Config, Data> = ({ config, data, region, width, height }) => {
  const tooltip = useTooltip<BamAlignment, Config>();
  const bases = region.end - region.start;

  // Coverage shows across the wide gate; if we're even beyond THAT, nothing to
  // draw. (Coverage is always part of every mode.)
  if (bases > config.coverageMaxBases) {
    return (
      <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="#999">
        Zoom in below {config.coverageMaxBases.toLocaleString()} bp to see signal
      </text>
    );
  }
  if (data.length === 0) return null;

  const mode = config.display;
  // Coverage always renders here. Pileup and sashimi are additionally gated by
  // their own (tighter) thresholds, so zooming out progressively drops reads,
  // then arcs, leaving the coverage signal — like a normal browser.
  const showArcs =
    (mode === "sashimi" || mode === "both") && bases <= config.sashimiMaxBases;
  const showReads =
    (mode === "pileup" || mode === "both") && bases <= config.maxBases;
  const showLower = showArcs || showReads;

  // Layout: coverage takes a top slice when anything is shown below it.
  const covH = showLower ? Math.round(height * 0.4) : height;
  const lowerY = covH + 4;
  const lowerH = height - lowerY;
  // When both arcs and reads share the lower area, split it.
  const arcH = showArcs && showReads ? Math.round(lowerH * 0.45) : lowerH;
  const readsY = showArcs && showReads ? lowerY + arcH + 2 : lowerY;
  const readsH = showArcs && showReads ? lowerH - arcH - 2 : lowerH;

  return (
    <>
      {/* Coverage: always on top */}
      <CoverageArea
        reads={data}
        region={region}
        width={width}
        height={covH}
        color={config.coverageColor}
      />

      {showArcs && (
        <g transform={`translate(0, ${lowerY})`}>
          <Sashimi
            reads={data}
            region={region}
            width={width}
            height={arcH}
            color={config.coverageColor}
            maxSpan={config.maxSpan}
          />
        </g>
      )}

      {showReads && (
        <g transform={`translate(0, ${readsY})`}>
          <Pileup
            reads={data}
            region={region}
            width={width}
            height={readsH}
            config={config}
            tooltip={tooltip}
          />
        </g>
      )}
    </>
  );
};

function BamSettings({ config, updateConfig }: TrackSettingsProps<Config>) {
  return (
    <SettingsSection title="BAM display">
      <label>
        Mode
        <select
          value={config.display}
          onChange={(e) =>
            updateConfig({ display: e.currentTarget.value as Config["display"] })
          }
        >
          <option value="coverage">Coverage</option>
          <option value="pileup">Reads</option>
          <option value="both">Both</option>
          <option value="sashimi">Sashimi</option>
        </select>
      </label>
    </SettingsSection>
  );
}

export const bamModule = defineTrackModule<BamAlignment>()({
  type: "bam",
  defaults: { height: 200, color: "#5b8bd0" },
  configSchema,
  async fetch({ config, region }): Promise<Data> {
    // Fetch reads if ANY enabled view is in range. Coverage (always part of
    // every mode) has the widest gate, so effectively: fetch when within the
    // widest of the views currently shown.
    const m = config.display;
    const gates: number[] = [config.coverageMaxBases]; // coverage always shown
    if (m === "pileup" || m === "both") gates.push(config.maxBases);
    if (m === "sashimi" || m === "both") gates.push(config.sashimiMaxBases);
    const gate = Math.max(...gates);
    if (region.end - region.start > gate) return [];
    const baiUrl = config.baiUrl ?? `${config.bamUrl}.bai`;
    const reader = getReader(config.bamUrl, baiUrl);
    const reads = await reader.read(region.chromosome, region.start, region.end);
    // Drop low-MAPQ (multi-mapping) reads — at paralogs like SMN these are the
    // ambiguous SMN1/SMN2 reads that create spurious long-range junctions.
    return config.minMapq > 0
      ? reads.filter((r) => r.mappingQuality >= config.minMapq)
      : reads;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: { full: BamRenderer as any },
  settingsComponent: BamSettings,
  tooltipComponent: ({ item }) => (
    <text>
      {item.readName} · {item.strand ? "+" : "-"} · MAPQ {item.mappingQuality}
    </text>
  ),
});
