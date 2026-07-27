import { useEffect, useState } from "react";
import { SAMPLES } from "./samples";
import { computePsi, type Exon, type PsiResult } from "./computePsi";
import { fetchSampleJunctions } from "./fetchJunctions";

export type ClickedTranscript = {
  name: string;
  chromosome: string;
  exons: Exon[];
};

type Row = { sample: (typeof SAMPLES)[number]; result: PsiResult };

export function PsiPanel({ transcript }: { transcript: ClickedTranscript | null }) {
  // Which exon index the user picked. Exons are in genomic order; the label
  // shows 1-based number so the user can find "exon 7".
  const [exonIndex, setExonIndex] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when a new transcript is clicked.
  useEffect(() => {
    setExonIndex(null);
    setRows(null);
    setError(null);
  }, [transcript]);

  useEffect(() => {
    if (!transcript || exonIndex === null) return;
    const exon = transcript.exons[exonIndex];
    if (!exon) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Read a window around the exon wide enough to catch skipping junctions
    // to neighboring exons (which can be several kb away).
    const pad = 10000;
    const region = {
      chromosome: transcript.chromosome,
      start: Math.max(0, exon.start - pad),
      end: exon.end + pad,
    };

    Promise.all(
      SAMPLES.map(async (sample) => {
        const junctions = await fetchSampleJunctions(sample.jxnUrl, region);
        return { sample, result: computePsi(exon, junctions) };
      }),
    )
      .then((results) => {
        if (!cancelled) setRows(results);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "PSI fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [transcript, exonIndex]);

  if (!transcript) {
    return (
      <p className="psi-hint">
        Click a transcript in the gene track to compute exon PSI across samples.
      </p>
    );
  }

  return (
    <div className="psi-panel">
      <h2>PSI · {transcript.name}</h2>

      <div className="psi-exon-pick">
        <label>Exon: </label>
        <select
          value={exonIndex ?? ""}
          onChange={(e) =>
            setExonIndex(e.target.value === "" ? null : Number(e.target.value))
          }
        >
          <option value="">— pick an exon —</option>
          {transcript.exons.map((ex, i) => (
            <option key={i} value={i}>
              exon {i + 1} ({ex.start.toLocaleString()}–{ex.end.toLocaleString()})
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="psi-hint">Computing across {SAMPLES.length} samples…</p>}
      {error && <p className="psi-error">{error}</p>}

      {rows && (
        <table className="psi-table">
          <thead>
            <tr>
              <th>Sample</th>
              <th>Condition</th>
              <th>PSI</th>
              <th>incl</th>
              <th>skip</th>
              <th>trust</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sample, result }) => {
              const uniqPct =
                result.uniqueFraction === null
                  ? "—"
                  : `${Math.round(result.uniqueFraction * 100)}% uniq`;
              const lowTrust =
                result.uniqueFraction !== null && result.uniqueFraction < 0.2;
              return (
                <tr key={sample.id}>
                  <td>{sample.label}</td>
                  <td>
                    <span className="psi-dot" style={{ background: sample.color }} />
                    {sample.condition}
                  </td>
                  <td className="psi-value">
                    {result.psi === null ? "—" : `${(result.psi * 100).toFixed(1)}%`}
                  </td>
                  <td>{result.inclusionReads}</td>
                  <td>{result.skippingReads}</td>
                  <td className={lowTrust ? "psi-lowtrust" : ""}>
                    {uniqPct}
                    {lowTrust ? " ⚠" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {rows && (
        <p className="psi-caveat">
          Low “trust” (mostly multi-mapping reads) means PSI can’t separate
          paralogs — at SMN it reflects SMN1+SMN2 combined, not SMN2 alone.
        </p>
      )}
    </div>
  );
}
