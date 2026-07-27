table junctionsSeq
"STAR splice junctions with read support and splice-site sequence"
    (
    string  chrom;        "Reference chromosome"
    uint    chromStart;   "Start of intron (0-based)"
    uint    chromEnd;     "End of intron (half-open)"
    string  name;         "Junction id"
    uint    score;        "min(readCount,1000)"
    char[1] strand;       "+ or - or ."
    uint    readCount;    "Total spanning reads"
    uint    uniqueCount;  "Uniquely-mapping reads"
    uint    multiCount;   "Multi-mapping reads"
    ubyte   annotated;    "1 if annotated"
    ubyte   motif;        "STAR motif code"
    string  donorDi;      "Donor dinucleotide, biological 5'->3' (canonical GT)"
    string  acceptorDi;   "Acceptor dinucleotide, biological (canonical AG)"
    string  donorCtx;     "Donor context, biological orientation"
    string  acceptorCtx;  "Acceptor context, biological orientation"
    )
