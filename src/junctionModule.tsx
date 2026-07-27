import { z } from "zod";
import {
  SettingsSection,
  defineTrackModule,
  fetchBigBedRows,
  fetchOnChange,
  useInteraction,
  useTooltip,
  type TrackRendererProps,
  type TrackSettingsProps,
} from "@weng-lab/genomebrowser";

/**
 * Sashimi-style junction track.
 *
 * Draws splice junctions as arcs between exon boundaries, with arc thickness
 * scaled to (log) read count and the raw count labeled at the apex. Pair it
 * with a bigWig coverage track underneath for the full sashimi picture.
 *
 * Data is an indexed bigBed produced by scripts/star_junctions_to_bed.py +
 * bedToBigBed. The browser reads only the visible region via HTTP range
 * requests, so it scales to many samples and large files. The bigBed's extra
 * columns (declared in junctions.as) are parsed via the schema below.
 *
 * `sample` is carried through so a future differential view can color or group
 * by condition without reshaping the data.
 */

/**
 * Field order MUST match the BED column order written by
 * star_junctions_to_bed.py and declared in junctions.as:
 *   chrom start end name score strand readCount uniqueCount multiCount annotated motif
 * The bigBed parser maps columns onto these keys positionally, so order matters.
 */
const junctionSchema = z.object({
  chrom: z.string(),
  start: z.coerce.number(),
  end: z.coerce.number(),
  name: z.string(),
  score: z.coerce.number(),
  strand: z.string(),
  readCount: z.coerce.number(),
  uniqueCount: z.coerce.number(),
  multiCount: z.coerce.number(),
  annotated: z.coerce.number(),
  motif: z.coerce.number(),
  // Splice-site sequence, biological 5'->3'. donorDi/acceptorDi are the
  // canonical dinucleotides (GT/AG); donorCtx/acceptorCtx are EXON]intron and
  // intron]EXON with the boundary marked by ]. Optional so a bigBed built by
  // the older converter (no sequence columns) still parses.
  donorDi: z.string().optional().default(""),
  acceptorDi: z.string().optional().default(""),
  donorCtx: z.string().optional().default(""),
  acceptorCtx: z.string().optional().default(""),
});

const configSchema = z.object({
  // URL of the per-sample junction JSON (or an endpoint that takes a region).
  url: fetchOnChange(z.string().min(1)),
  // Hide junctions below this many reads; re-renders without refetching.
  minCount: z.number().default(3),
  // Hide junctions whose genomic span (end - start) is outside these bounds.
  // maxSpan is the useful one for paralog regions like SMN: multi-mapped reads
  // produce spurious long-range junctions (one paralog's exon to another's)
  // that render as flat streaks. Capping the span drops them. minSpan removes
  // implausibly short junctions. Both optional; unset = no span filtering.
  minSpan: z.number().optional(),
  maxSpan: z.number().optional(),
  // Optional identity for grouping/coloring later.
  sample: z.string().optional(),
  arcColor: z.string().default("#2266aa"),
  // Draw annotated and novel junctions differently.
  novelColor: z.string().default("#c44"),
});

type Config = z.infer<typeof configSchema>;

type Junction = {
  chromosome: string;
  start: number;
  end: number;
  count: number;
  unique: number;
  multi: number;
  strand: "+" | "-" | ".";
  annotated: boolean;
  motif: number;
  donorDi: string;
  acceptorDi: string;
  donorCtx: string;
  acceptorCtx: string;
};

type Data = Junction[];

function JunctionRenderer({
  config,
  data,
  region,
  width,
  height,
}: TrackRendererProps<Config, Data>) {
  const interaction = useInteraction<Junction>();
  const tooltip = useTooltip<Junction, Config>();
  const bases = region.end - region.start;

  const visible = data.filter((j) => {
    if (j.count < config.minCount) return false;
    const span = j.end - j.start;
    if (config.minSpan !== undefined && span < config.minSpan) return false;
    if (config.maxSpan !== undefined && span > config.maxSpan) return false;
    return true;
  });
  if (visible.length === 0) return null;

  const maxCount = Math.max(...visible.map((j) => j.count));
  const toX = (pos: number) => ((pos - region.start) / bases) * width;

  // Arc apex sits near the top; leave a little room for the count label.
  const baseline = height - 2;
  const apexY = 12;

  // Thickness scales with log count so a 500-read junction doesn't dwarf a
  // 5-read one into invisibility.
  const strokeFor = (count: number) => {
    const t = Math.log1p(count) / Math.log1p(maxCount);
    return 0.75 + t * 3.25; // 0.75–4px
  };

  return (
    <>
      {visible.map((j) => {
        const x1 = toX(j.start);
        const x2 = toX(j.end);
        const midX = (x1 + x2) / 2;
        // Quadratic curve from left boundary up to an apex and down to the right.
        const path = `M ${x1} ${baseline} Q ${midX} ${apexY} ${x2} ${baseline}`;
        const color = j.annotated ? config.arcColor : config.novelColor;

        return (
          <g key={`${j.start}-${j.end}`}>
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={strokeFor(j.count)}
              opacity={0.85}
              style={{ cursor: "pointer" }}
              onClick={() => interaction?.onClick?.(j)}
              onMouseEnter={(event) => tooltip.show(j, event)}
              onMouseLeave={tooltip.hide}
            />
            <text
              x={midX}
              y={apexY - 2}
              textAnchor="middle"
              fontSize={10}
              fill={color}
            >
              {j.count}
            </text>
          </g>
        );
      })}
    </>
  );
}

function JunctionSettings({ config, updateConfig }: TrackSettingsProps<Config>) {
  return (
    <SettingsSection title="Junctions">
      <label>
        Min reads
        <input
          type="number"
          min={1}
          value={config.minCount}
          onChange={(event) => {
            const result = updateConfig({
              minCount: event.currentTarget.valueAsNumber,
            });
            if (!result.ok) console.error(result.error);
          }}
        />
      </label>
    </SettingsSection>
  );
}

export const junctionModule = defineTrackModule<Junction>()({
  type: "sashimi-junction",
  defaults: { height: 90, color: "#2266aa" },
  configSchema,
  async fetch({ config, region }): Promise<Data> {
    // Range-read only the visible region from the bigBed. The package's reader
    // issues HTTP range requests against the index, so payload scales with the
    // window, not the file. The schema unpacks our extra columns.
    const rows = await fetchBigBedRows({
      url: config.url,
      region,
      schema: junctionSchema,
    });
    return rows.map((row) => ({
      chromosome: row.chrom ?? region.chromosome,
      start: row.start,
      end: row.end,
      count: row.readCount,
      unique: row.uniqueCount,
      multi: row.multiCount,
      strand: (row.strand as Junction["strand"]) ?? ".",
      annotated: row.annotated === 1,
      motif: row.motif,
      donorDi: row.donorDi ?? "",
      acceptorDi: row.acceptorDi ?? "",
      donorCtx: row.donorCtx ?? "",
      acceptorCtx: row.acceptorCtx ?? "",
    }));
  },
  render: { full: JunctionRenderer },
  settingsComponent: JunctionSettings,
  tooltipComponent: ({ item }) => {
    // Split "EXON]intron" so we can style the boundary and the canonical
    // dinucleotide. donorCtx = EXON]gt..., acceptorCtx = ...ag]EXON.
    const canonical =
      item.donorDi === "GT" && item.acceptorDi === "AG";
    const line = 15;
    const mono = { fontFamily: "monospace", fontSize: 12 } as const;

    return (
      <g>
        <text {...mono} y={0}>
          {item.count} reads ({item.unique} uniq / {item.multi} multi)
        </text>
        <text {...mono} y={line}>
          {item.annotated ? "annotated" : "novel"} · {item.strand} ·{" "}
          {canonical ? "canonical GT-AG" : `non-canonical ${item.donorDi}-${item.acceptorDi}`}
        </text>
        {item.donorCtx && (
          <text {...mono} y={line * 2.4}>
            <tspan fill="#666">donor    </tspan>
            <tspan fill="#111">{item.donorCtx}</tspan>
          </text>
        )}
        {item.acceptorCtx && (
          <text {...mono} y={line * 3.4}>
            <tspan fill="#666">acceptor </tspan>
            <tspan fill="#111">{item.acceptorCtx}</tspan>
          </text>
        )}
      </g>
    );
  },
});
