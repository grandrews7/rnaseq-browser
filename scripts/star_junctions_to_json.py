#!/usr/bin/env python3
"""
Convert one or more STAR SJ.out.tab files into the compact junction JSON the
sashimi track reads.

STAR SJ.out.tab columns (tab-separated, no header):
  1 chromosome
  2 intron start (1-based, first base of the intron)
  3 intron end   (1-based, last base of the intron)
  4 strand       (0 undefined, 1 +, 2 -)
  5 intron motif (0 non-canonical, 1 GT/AG, 2 CT/AC, ...)
  6 annotated    (0 novel, 1 in annotation)
  7 number of uniquely-mapping reads spanning the junction
  8 number of multi-mapping reads spanning the junction
  9 maximum spliced alignment overhang

Output: one JSON file per sample, an array of
  { "chromosome", "start", "end", "count", "strand", "annotated", "motif" }

Design notes:
  - `start`/`end` are the intron boundaries, i.e. the exon-exon junction the
    arc connects. We keep STAR's coordinates as-is (1-based inclusive intron);
    the renderer only needs relative positions within a region, so the exact
    base convention doesn't affect the picture as long as it's consistent.
  - `count` is uniquely-mapping reads by default. Multi-mappers are noisy for
    splicing; pass --include-multi to add them.
  - We drop junctions below --min-count to keep files small and plots readable;
    single-read junctions are usually noise.
"""

import argparse
import json
import os
import sys

STRAND = {"0": ".", "1": "+", "2": "-"}


def convert(path, min_count, include_multi):
    junctions = []
    with open(path) as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            fields = line.split("\t")
            if len(fields) < 9:
                sys.stderr.write(
                    f"  skipping malformed line {line_number} in {path}\n"
                )
                continue
            unique = int(fields[6])
            multi = int(fields[7])
            count = unique + multi if include_multi else unique
            if count < min_count:
                continue
            junctions.append(
                {
                    "chromosome": fields[0],
                    "start": int(fields[1]),
                    "end": int(fields[2]),
                    "count": count,
                    "strand": STRAND.get(fields[3], "."),
                    "annotated": fields[5] == "1",
                    "motif": int(fields[4]),
                }
            )
    # Largest arcs drawn last (on top) reads better; sort ascending by count.
    junctions.sort(key=lambda j: j["count"])
    return junctions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", help="STAR SJ.out.tab file(s)")
    parser.add_argument(
        "-o", "--outdir", default="public/junctions", help="output directory"
    )
    parser.add_argument(
        "--min-count", type=int, default=2, help="drop junctions below this read count"
    )
    parser.add_argument(
        "--include-multi",
        action="store_true",
        help="add multi-mapping reads to the count",
    )
    args = parser.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    for path in args.inputs:
        # sample name from parent dir if file is literally SJ.out.tab, else basename
        base = os.path.basename(path)
        if base == "SJ.out.tab":
            sample = os.path.basename(os.path.dirname(os.path.abspath(path)))
        else:
            sample = base.replace(".SJ.out.tab", "").replace(".tab", "")
        junctions = convert(path, args.min_count, args.include_multi)
        out = os.path.join(args.outdir, f"{sample}.json")
        with open(out, "w") as handle:
            json.dump(junctions, handle)
        total = sum(j["count"] for j in junctions)
        print(f"{path} -> {out}  ({len(junctions)} junctions, {total} reads)")


if __name__ == "__main__":
    main()
