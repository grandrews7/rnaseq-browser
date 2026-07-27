import type { ClickedTranscript } from "./PsiPanel";

/**
 * Tiny event bridge so the gene track's onClick (created at module scope,
 * outside React) can hand a clicked transcript to the PsiPanel (inside React)
 * without recreating the track or the stores on every render.
 */
type Listener = (t: ClickedTranscript) => void;
let listener: Listener | null = null;

export function onTranscriptClick(fn: Listener) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function emitTranscriptClick(t: ClickedTranscript) {
  listener?.(t);
}
