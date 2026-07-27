/**
 * Cassette-exon PSI (percent spliced in) from junction counts.
 *
 * For a given exon [start, end):
 *   inclusion = junctions that touch a boundary of THIS exon
 *       - end == exon.start  (upstream intron joins into the exon), or
 *       - start == exon.end   (exon splices out to downstream)
 *   skipping  = junctions that span ACROSS the exon without touching it
 *       - start < exon.start && end > exon.end
 *
 *   PSI = inclusion / (inclusion + skipping)
 *
 * Coordinates use a small tolerance because STAR intron boundaries and GENCODE
 * exon coordinates can differ by a base depending on convention.
 */

export type Junction = {
  start: number;
  end: number;
  count: number;
  unique: number;
  multi: number;
};

export type Exon = { start: number; end: number };

export type PsiResult = {
  psi: number | null; // null when no informative reads
  inclusionReads: number;
  skippingReads: number;
  inclusionJunctions: Junction[];
  skippingJunctions: Junction[];
  // trust: fraction of contributing reads that are uniquely mapping (0..1),
  // null when no reads. Low value => paralog-ambiguous (e.g. SMN1/SMN2).
  uniqueFraction: number | null;
};

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

export function computePsi(
  exon: Exon,
  junctions: Junction[],
  tol = 2,
): PsiResult {
  const inclusionJunctions: Junction[] = [];
  const skippingJunctions: Junction[] = [];

  for (const j of junctions) {
    const touchesStart = near(j.end, exon.start, tol);
    const touchesEnd = near(j.start, exon.end, tol);
    const spansOver = j.start < exon.start - tol && j.end > exon.end + tol;

    if (touchesStart || touchesEnd) {
      inclusionJunctions.push(j);
    } else if (spansOver) {
      skippingJunctions.push(j);
    }
  }

  const inclusionReads = inclusionJunctions.reduce((s, j) => s + j.count, 0);
  const skippingReads = skippingJunctions.reduce((s, j) => s + j.count, 0);
  const total = inclusionReads + skippingReads;

  const contributing = [...inclusionJunctions, ...skippingJunctions];
  const uniqueReads = contributing.reduce((s, j) => s + j.unique, 0);
  const allReads = contributing.reduce((s, j) => s + j.count, 0);

  return {
    psi: total > 0 ? inclusionReads / total : null,
    inclusionReads,
    skippingReads,
    inclusionJunctions,
    skippingJunctions,
    uniqueFraction: allReads > 0 ? uniqueReads / allReads : null,
  };
}
