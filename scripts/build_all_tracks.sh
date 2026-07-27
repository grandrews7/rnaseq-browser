#!/usr/bin/env bash
#
# Build coverage bigWigs and junction bigBeds for every STAR sample directory,
# writing outputs into the web-served directory so the browser can range-read
# them over HTTP.
#
# Per sample it produces:
#   <sample>.bw            coverage (bamCoverage / deepTools)
#   <sample>.junctions.bb  splice junctions (star_junctions_to_bed + bedToBigBed)
#
# Run from the repo root, in the deeptools conda env. Idempotent-ish: it
# overwrites existing outputs, so re-running after adding a sample is fine.
#
# Usage:
#   bash scripts/build_all_tracks.sh
#
# Then paste the App.tsx track entries it prints at the end.

set -euo pipefail

# ---- configure these three paths if your layout differs ----
BAM_ROOT="/zata/zippy/andrewsg/projects/risdiplam/data/bam"
WEB_DIR="/zata/public_html/users/andrewsg/browser"
CHROM_SIZES="/zata/zippy/andrewsg/genome/hg38/hg38.chrom.sizes"
FASTA="/zata/zippy/andrewsg/genome/hg38/hg38.fa"
# public URL base that maps to WEB_DIR
URL_BASE="https://users.wenglab.org/andrewsg/browser"

# junction filtering
MIN_COUNT=3
INCLUDE_MULTI="--include-multi"   # needed for paralogs like SMN; set "" to drop

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONVERTER="$REPO_ROOT/scripts/star_junctions_add_sequence.py"
AUTOSQL="$REPO_ROOT/scripts/junctions_seq.as"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Writing tracks to: $WEB_DIR"
echo

# collect track entries to print at the end
declare -a ENTRIES

for dir in "$BAM_ROOT"/*/; do
  sample="$(basename "$dir")"
  bam="$dir/Aligned.sortedByCoord.out.bam"
  sj="$dir/SJ.out.tab"

  if [[ ! -f "$bam" ]]; then
    echo "!! $sample: no BAM at $bam — skipping coverage"
  fi
  if [[ ! -f "$sj" ]]; then
    echo "!! $sample: no SJ.out.tab — skipping junctions"
  fi

  echo "== $sample =="

  # ---- coverage bigWig ----
  if [[ -f "$bam" ]]; then
    # index if needed
    [[ -f "$bam.bai" ]] || samtools index "$bam"
    echo "  coverage -> $sample.bw"
    bamCoverage \
      --bam "$bam" \
      --outFileName "$WEB_DIR/$sample.bw" \
      --binSize 10 \
      --normalizeUsing CPM \
      --numberOfProcessors 4 \
      >/dev/null 2>&1
  fi

  # ---- junction bigBed ----
  if [[ -f "$sj" ]]; then
    echo "  junctions -> $sample.junctions.bb"
    python3 "$CONVERTER" "$sj" -o "$TMP/$sample.bed" \
      --fasta "$FASTA" \
      --min-count "$MIN_COUNT" $INCLUDE_MULTI >/dev/null
    sort -k1,1 -k2,2n "$TMP/$sample.bed" > "$TMP/$sample.sorted.bed"
    bedToBigBed -as="$AUTOSQL" -type=bed6+9 \
      "$TMP/$sample.sorted.bed" "$CHROM_SIZES" \
      "$WEB_DIR/$sample.junctions.bb" 2>/dev/null
  fi

  # infer a readable title and a color by condition
  case "$sample" in
    *neg.ctrl*)      color="#888888" ;;   # controls grey
    *1um*)           color="#c0392b" ;;   # high dose red
    *655nm*)         color="#e67e22" ;;   # low dose orange
    *)               color="#2266aa" ;;
  esac

  ENTRIES+=("  // $sample
  bigWigModule.create({
    id: \"$sample-cov\",
    title: \"$sample — coverage\",
    height: 50,
    color: \"$color\",
    config: { url: \"$URL_BASE/$sample.bw\", fillWithZero: true },
  }),
  junctionModule.create({
    id: \"$sample-jxn\",
    title: \"$sample — junctions\",
    height: 90,
    config: {
      url: \"$URL_BASE/$sample.junctions.bb\",
      minCount: $MIN_COUNT,
      maxSpan: 30000,
      arcColor: \"$color\",
      sample: \"$sample\",
    },
  }),")
done

echo
echo "=================================================================="
echo "Done. Paste these track entries into the tracks array in App.tsx:"
echo "=================================================================="
echo
for e in "${ENTRIES[@]}"; do
  echo "$e"
done
