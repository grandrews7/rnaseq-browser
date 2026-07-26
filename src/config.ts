/**
 * ============================================================
 *  THIS IS THE ONLY FILE YOU NEED TO EDIT.
 * ============================================================
 *
 * Point `tracks` at your RNA-seq bigWig files and set a starting region.
 *
 * Notes on URLs:
 *  - They must be reachable from the browser over HTTP(S).
 *  - The server must support HTTP Range requests (the browser reads
 *    only the slice of the bigWig it needs, not the whole file).
 *  - If the files are on a different host than this dev server, that
 *    host must send permissive CORS headers, including
 *    Access-Control-Allow-Headers: range and
 *    Access-Control-Expose-Headers: content-range.
 *  - Local files: drop them in ./public and use "/my-sample.bw".
 */

export type RnaSeqTrack = {
  id: string;
  title: string;
  url: string;
  color?: string;
  height?: number;
  /** Fix the y-axis so samples are visually comparable. Omit to autoscale. */
  yRange?: { min: number; max: number };
};

/** Starting view. Format: "chr:start-end". */
export const INITIAL_REGION = "chr5:71035000-71080000";

/** Genome assembly used by the gene annotation track. */
export const ASSEMBLY = "GRCh38";

/**
 * GENCODE version to request from the server.
 *
 * The docs say 47, but the repo's own working examples both use 40. If the
 * gene track comes up empty with no error, the version you asked for probably
 * isn't loaded server-side — try the other one.
 */
export const GENCODE_VERSION = 40;

/** Set false if the gene track's GraphQL endpoint isn't wired up yet. */
export const SHOW_GENE_TRACK = true;

/**
 * "pack" gives every transcript its own row, which is what you want if the
 * server is serving GENCODE's comprehensive set (all isoforms per gene).
 * "squish" collapses them onto one row — compact, but hides isoform structure.
 */
export const GENE_TRACK_DISPLAY: "pack" | "squish" = "pack";
export const GENE_TRACK_HEIGHT = 220;

/** Optional: highlight transcripts whose name matches, e.g. "HNF1A". */
export const HIGHLIGHT_GENE: string | undefined = undefined;

/** Color for MANE Select (canonical) transcripts, so they stand out. */
export const CANONICAL_COLOR = "#d45c2f";
export const HIGHLIGHT_COLOR = "#1f77b4";

export const TRACKS: RnaSeqTrack[] = [
  {
    id: "sample-1",
    title: "Sample 1 (control, rep 1)",
    url: "https://users.wenglab.org/andrewsg/browser/ENCFF113VII.bigWig",
    color: "#2266aa",
    height: 60,
    yRange: { min: 0, max: 5 },
  }
];
