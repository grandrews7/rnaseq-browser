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
  maxBases: z.number().default(20000),
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
function computeCoverage(reads: BamAlignment[], start: number, end: number): number[] {
  const len = Math.max(0, end - start);
  const cov = new Array<number>(len).fill(0);
  for (const r of reads) {
    let ref = r.start;
    for (const c of r.cigarOps) {
      if (c.op === "M" || c.op === "=" || c.op === "X") {
        for (let p = ref; p < ref + c.opLen; p++) {
          const i = p - start;
          if (i >= 0 && i < len) cov[i]++;
        }
        ref += c.opLen;
      } else if (c.op === "N" || c.op === "D") {
        ref += c.opLen;
      }
    }
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
  const cov = computeCoverage(reads, region.start, region.end);
  const max = Math.max(1, ...cov);
  // Build a filled path sampled per pixel column (cheaper than per-base for wide views).
  const cols = Math.min(width, bases);
  const step = bases / cols;
  let d = `M 0 ${height}`;
  for (let c = 0; c <= cols; c++) {
    const basePos = Math.floor(c * step);
    const depth = cov[Math.min(cov.length - 1, basePos)] ?? 0;
    const x = (c / cols) * width;
    const y = height - (depth / max) * height;
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
}: {
  reads: BamAlignment[];
  region: { start: number; end: number };
  width: number;
  height: number;
  color: string;
}) {
  const bases = region.end - region.start;
  const toX = (pos: number) => ((pos - region.start) / bases) * width;
  const junctions = junctionsFromReads(reads).filter(
    (j) => j.end >= region.start && j.start <= region.end,
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

  if (bases > config.maxBases) {
    return (
      <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="#999">
        Zoom in below {config.maxBases.toLocaleString()} bp to see BAM data
      </text>
    );
  }
  if (data.length === 0) return null;

  const mode = config.display;
  const covH = mode === "both" ? Math.round(height * 0.35) : height;
  const pileH = mode === "both" ? height - covH - 4 : height;

  if (mode === "sashimi") {
    return (
      <Sashimi
        reads={data}
        region={region}
        width={width}
        height={height}
        color={config.coverageColor}
      />
    );
  }

  return (
    <>
      {(mode === "coverage" || mode === "both") && (
        <CoverageArea
          reads={data}
          region={region}
          width={width}
          height={covH}
          color={config.coverageColor}
        />
      )}
      {(mode === "pileup" || mode === "both") && (
        <g transform={mode === "both" ? `translate(0, ${covH + 4})` : undefined}>
          <Pileup
            reads={data}
            region={region}
            width={width}
            height={pileH}
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
    if (region.end - region.start > config.maxBases) return [];
    const baiUrl = config.baiUrl ?? `${config.bamUrl}.bai`;
    const reader = getReader(config.bamUrl, baiUrl);
    return reader.read(region.chromosome, region.start, region.end);
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
