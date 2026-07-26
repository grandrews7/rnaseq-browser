table junctions
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
