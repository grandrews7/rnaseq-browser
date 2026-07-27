/**
 * Sample registry shared by the track list (App.tsx) and the PSI panel.
 * Single source of truth so adding a sample updates both.
 */
export type SampleDef = {
  id: string;
  label: string;
  condition: "control" | "655nM" | "1uM";
  color: string;
  covUrl: string;
  jxnUrl: string;
};

const BASE = "https://users.wenglab.org/andrewsg/browser";

const mk = (
  id: string,
  condition: SampleDef["condition"],
  color: string,
): SampleDef => ({
  id,
  label: id,
  condition,
  color,
  covUrl: `${BASE}/${id}.bw`,
  jxnUrl: `${BASE}/${id}.junctions.bb`,
});

// Ordered by ascending dose so the PSI table reads control -> 655nM -> 1uM.
export const SAMPLES: SampleDef[] = [
  mk("Exp1_neg.ctrl_rep1", "control", "#888888"),
  mk("Exp1_neg.ctrl_rep2", "control", "#888888"),
  mk("Exp1_neg.ctrl_rep3", "control", "#888888"),
  mk("Exp1_risdiplam_655nm_rep1", "655nM", "#e67e22"),
  mk("Exp1_risdiplam_655nm_rep2", "655nM", "#e67e22"),
  mk("Exp1_risdiplam_655nm_rep3", "655nM", "#e67e22"),
  mk("Exp1_risdiplam_1um_rep1", "1uM", "#c0392b"),
  mk("Exp1_risdiplam_1um_rep2", "1uM", "#c0392b"),
  mk("Exp1_risdiplam_1um_rep3", "1uM", "#c0392b"),
];
