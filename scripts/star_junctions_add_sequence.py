#!/usr/bin/env python3
"""
Add splice-site sequence to junction BED, extracted from an indexed genome
FASTA via samtools faidx, in biological 5'->3' orientation.

Run on the cluster where samtools + the FASTA (.fai) live. Produces the same
BED as star_junctions_to_bed.py plus four extra columns:
  donorDi     donor dinucleotide (canonical = GT)
  acceptorDi  acceptor dinucleotide (canonical = AG)
  donorCtx    ~CONTEXT bp of donor context, biological orientation
  acceptorCtx ~CONTEXT bp of acceptor context, biological orientation

STRAND HANDLING (the subtle part):
  A junction's [start,end) is the intron (0-based half-open, as we write it).
  We faidx the genomic interval, then:
    - plus strand:  donor = 5' end (near start), acceptor = 3' end (near end)
    - minus strand: reverse-complement the whole interval; THEN donor is the
      5' end of that biological sequence, acceptor the 3' end.
  Canonical junctions read GT...AG in biological orientation regardless of
  strand. STAR's motif column is an independent check: motif 1/2 = canonical.

VALIDATE on SMN2 before trusting: canonical junctions must show donorDi=GT,
acceptorDi=AG. If minus-strand junctions show donorDi=AC, the revcomp is
inverted.

Requires: samtools on PATH, FASTA with a .fai index.

Usage:
  python3 star_junctions_add_sequence.py SJ.out.tab \\
    --fasta /path/hg38.fa -o out.bed --include-multi --min-count 3

This replaces star_junctions_to_bed.py when you want sequence columns.
Use -type=bed6+9 for bedToBigBed and the extended autoSql (junctions_seq.as).
"""

import argparse
import subprocess
import sys

STRAND = {"0": ".", "1": "+", "2": "-"}
CONTEXT = 8  # bp of context each side, beyond the 2bp dinucleotide

_COMP = str.maketrans("ACGTNacgtn", "TGCANtgcan")


def revcomp(s):
    return s.translate(_COMP)[::-1]


def faidx_batch(fasta, regions):
    """Fetch many regions in one samtools call. regions: list of 'chr:start-end'
    (1-based inclusive, samtools convention). Returns dict region->sequence."""
    if not regions:
        return {}
    # samtools faidx accepts many regions as args; batch to avoid huge arg lists
    out = {}
    CHUNK = 500
    for i in range(0, len(regions), CHUNK):
        batch = regions[i : i + CHUNK]
        proc = subprocess.run(
            ["samtools", "faidx", fasta, *batch],
            capture_output=True, text=True, check=True,
        )
        name = None
        seq = []
        for line in proc.stdout.splitlines():
            if line.startswith(">"):
                if name is not None:
                    out[name] = "".join(seq).upper()
                name = line[1:].strip()
                seq = []
            else:
                seq.append(line.strip())
        if name is not None:
            out[name] = "".join(seq).upper()
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input")
    p.add_argument("--fasta", required=True, help="genome FASTA (indexed, .fai)")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--min-count", type=int, default=3)
    p.add_argument("--include-multi", action="store_true")
    args = p.parse_args()

    # Pass 1: read junctions, collect the two flanking regions we need per junction.
    junctions = []
    donor_regions = []
    acceptor_regions = []
    with open(args.input) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            c = line.split("\t")
            if len(c) < 9:
                continue
            chrom = c[0]
            s1, e1 = int(c[1]), int(c[2])       # 1-based inclusive intron
            strand = STRAND.get(c[3], ".")
            motif = int(c[4])
            annotated = 1 if c[5] == "1" else 0
            unique, multi = int(c[6]), int(c[7])
            count = unique + multi if args.include_multi else unique
            if count < args.min_count:
                continue

            start0 = s1 - 1                       # 0-based half-open BED
            end0 = e1

            # Flanking regions in samtools 1-based inclusive coords.
            # We grab a window at each intron end big enough for di + context.
            w = 2 + CONTEXT
            left_reg = f"{chrom}:{s1}-{s1 + w - 1}"          # 5' genomic end
            right_reg = f"{chrom}:{e1 - w + 1}-{e1}"          # 3' genomic end
            donor_regions.append(left_reg)
            acceptor_regions.append(right_reg)

            junctions.append({
                "chrom": chrom, "start0": start0, "end0": end0,
                "strand": strand, "motif": motif, "annotated": annotated,
                "unique": unique, "multi": multi, "count": count,
                "left_reg": left_reg, "right_reg": right_reg,
            })

    # Fetch all sequence in batched samtools calls.
    all_regions = list({r for j in junctions for r in (j["left_reg"], j["right_reg"])})
    seq = faidx_batch(args.fasta, all_regions)

    # Pass 2: assemble biological donor/acceptor and write BED.
    written = 0
    with open(args.out, "w") as out:
        for j in junctions:
            left = seq.get(j["left_reg"], "")   # genomic 5' window
            right = seq.get(j["right_reg"], "") # genomic 3' window
            if j["strand"] == "-":
                # biological donor is revcomp of the genomic 3' window;
                # biological acceptor is revcomp of the genomic 5' window.
                donor = revcomp(right)
                acceptor = revcomp(left)
            else:
                donor = left
                acceptor = right
            donor_di = donor[:2]
            acceptor_di = acceptor[-2:]
            donor_ctx = donor
            acceptor_ctx = acceptor

            name = f"{j['chrom']}:{j['start0']}-{j['end0']}"
            score = min(j["count"], 1000)
            out.write(
                f"{j['chrom']}\t{j['start0']}\t{j['end0']}\t{name}\t{score}\t"
                f"{j['strand']}\t{j['count']}\t{j['unique']}\t{j['multi']}\t"
                f"{j['annotated']}\t{j['motif']}\t"
                f"{donor_di}\t{acceptor_di}\t{donor_ctx}\t{acceptor_ctx}\n"
            )
            written += 1

    print(f"{args.input} -> {args.out}  ({written} junctions with sequence)")
    # Quick self-check summary: how many canonical-by-motif also show GT..AG
    print("  Validate: canonical junctions should show donorDi=GT, acceptorDi=AG.")


if __name__ == "__main__":
    main()
