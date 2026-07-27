import { fetchBigBedRows } from "@weng-lab/genomebrowser";
import { z } from "zod";
import type { Junction } from "./computePsi";

// Same column order as junctions.as (bed6+9). Only the fields PSI needs.
const psiJunctionSchema = z.object({
  chrom: z.string(),
  start: z.coerce.number(),
  end: z.coerce.number(),
  name: z.string(),
  score: z.coerce.number(),
  strand: z.string(),
  readCount: z.coerce.number(),
  uniqueCount: z.coerce.number(),
  multiCount: z.coerce.number(),
});

/** Range-read one sample's junctions overlapping a region. */
export async function fetchSampleJunctions(
  url: string,
  region: { chromosome: string; start: number; end: number },
): Promise<Junction[]> {
  const rows = await fetchBigBedRows({ url, region, schema: psiJunctionSchema });
  return rows.map((r) => ({
    start: r.start,
    end: r.end,
    count: r.readCount,
    unique: r.uniqueCount,
    multi: r.multiCount,
  }));
}
