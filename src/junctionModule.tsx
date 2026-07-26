import { z } from "zod";
import {
  SettingsSection,
  defineTrackModule,
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
 * Data is the compact JSON produced by scripts/star_junctions_to_json.py.
 * `sample` is carried through so a future differential view can color or group
 * by condition without reshaping the data.
 */

const configSchema = z.object({
  // URL of the per-sample junction JSON (or an endpoint that takes a region).
  url: fetchOnChange(z.string().min(1)),
  // Hide junctions below this many reads; re-renders without refetching.
  minCount: z.number().default(3),
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
  strand: "+" | "-" | ".";
  annotated: boolean;
  motif: number;
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

  const visible = data.filter((j) => j.count >= config.minCount);
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
    // Static per-sample file: fetch whole, filter to region client-side.
    // For a region endpoint, append region params here instead.
    const response = await fetch(config.url);
    if (!response.ok) {
      throw new Error(`Junction request failed with ${response.status}`);
    }
    const all = (await response.json()) as Data;
    return all.filter(
      (j) =>
        j.chromosome === region.chromosome &&
        j.end >= region.start &&
        j.start <= region.end,
    );
  },
  render: { full: JunctionRenderer },
  settingsComponent: JunctionSettings,
  tooltipComponent: ({ item }) => (
    <text>
      {item.count} reads · {item.annotated ? "annotated" : "novel"} ·{" "}
      {item.strand}
    </text>
  ),
});
