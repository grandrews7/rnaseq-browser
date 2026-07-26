#!/usr/bin/env python3
"""
Convert STAR SJ.out.tab into BED ready for bedToBigBed, for the sashimi track.

A splice junction is one interval — the intron — carrying a read count and some
metadata. That maps directly onto a BED feature: chrom/start/end are the intron
(the two splice sites the arc connects), and the read count plus flags ride in
extra typed columns declared by the accompanying autoSql (.as) file.

Coordinate handling (important):
  STAR SJ.out.tab is 1-based, giving the first and last base of the INTRON.
  BED is 0-based, half-open. For an intron whose 1-based inclusive span is
  [s, e], the BED interval is [s-1, e]:
    - start: s (1-based first intron base) -> s-1 (0-based)
    - end:   e (1-based last intron base, inclusive) -> e (0-based half-open)
  The arc is drawn between these two boundaries, i.e. the flanking exon edges.

Emit: a BED file with columns
  chrom  start  end  name  score  strand  readCount  uniqueCount  multiCount  annotated  motif
Then, on the cluster:
  sort -k1,1 -k2,2n  sample.bed  > sample.sorted.bed
  bedToBigBed -as=junctions.as -type=bed6+5 sample.sorted.bed chrom.sizes sample.junctions.bb
"""

import argparse
import os
import sys

STRAND = {"0": ".", "1": "+", "2": "-"}

AUTOSQL = """table junctions
"STAR splice junctions with read support"
    (
    string  chrom;        "Reference sequence chromosome"
    uint    chromStart;   "Start of intron (0-based)"
    uint    chromEnd;     "End of intron (half-open)"
    string  name;         "Junction id"
    uint    score;        "BED score, min(readCount,1000) for compatibility"
    char[1] strand;       "+ or - or ."
    uint    readCount;    "Total spanning reads (unique + optionally multi)"
    uint    uniqueCount;  "Uniquely-mapping spanning reads"
    uint    multiCount;   "Multi-mapping spanning reads"
    ubyte   annotated;    "1 if in annotation, else 0"
    ubyte   motif;        "STAR intron motif code"
    )
"""


def convert(path, min_count, include_multi, handle):
    kept = 0
    with open(path) as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            c = line.split("\t")
            if len(c) < 9:
                sys.stderr.write(f"  skip malformed line {n} in {path}\n")
                continue
            chrom = c[0]
            s1, e1 = int(c[1]), int(c[2])           # 1-based inclusive intron
            strand = STRAND.get(c[3], ".")
            motif = int(c[4])
            annotated = 1 if c[5] == "1" else 0
            unique = int(c[6])
            multi = int(c[7])
            count = unique + multi if include_multi else unique
            if count < min_count:
                continue
            start0 = s1 - 1                          # -> 0-based
            end0 = e1                                # half-open
            name = f"{chrom}:{start0}-{end0}"
            score = min(count, 1000)
            handle.write(
                f"{chrom}\t{start0}\t{end0}\t{name}\t{score}\t{strand}\t"
                f"{count}\t{unique}\t{multi}\t{annotated}\t{motif}\n"
            )
            kept += 1
    return kept


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", help="STAR SJ.out.tab")
    p.add_argument("-o", "--out", required=True, help="output .bed path")
    p.add_argument("--min-count", type=int, default=3)
    p.add_argument("--include-multi", action="store_true",
                   help="add multi-mapping reads to the count "
                        "(needed for paralogs like SMN; see caveat in README)")
    p.add_argument("--write-as", metavar="PATH",
                   help="also write the autoSql schema to this path")
    args = p.parse_args()

    with open(args.out, "w") as handle:
        kept = convert(args.input, args.min_count, args.include_multi, handle)
    print(f"{args.input} -> {args.out}  ({kept} junctions)")

    if args.write_as:
        with open(args.write_as, "w") as f:
            f.write(AUTOSQL)
        print(f"autoSql schema -> {args.write_as}")


if __name__ == "__main__":
    main()
