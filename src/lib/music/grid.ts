// Grille d'accords façon tab : texte -> rangées de pads, + voicing serré pour
// la détection d'accords d'un clavier arrangeur.
//
// Format :
//   - une ligne = une rangée de pads
//   - séparateurs : espaces, virgules, points-virgules, barres de mesure |
//   - %  répète l'accord précédent de la rangée
//   - -  ou  .  laisse une case vide (espacement)
//   - commentaires : // n'importe où, # en début de ligne
//   - une ligne commençant par « : » est un titre de section (ex. « :Refrain »)

import { parseChord, labelFor, type ChordCell } from './layout';

export interface GridPad {
  cell: ChordCell | null; // null = case vide
  token: string;
}

export interface GridRow {
  title?: string;
  pads: GridPad[];
}

export interface GridResult {
  rows: GridRow[];
  errors: string[];
}

const EMPTY = new Set(['-', '.', '_']);

export function parseGrid(text: string): GridResult {
  const rows: GridRow[] = [];
  const errors: string[] = [];
  let pendingTitle: string | undefined;

  text.split(/\r?\n/).forEach((raw, li) => {
    const line = raw.replace(/\/\/.*$/, '').replace(/^\s*#.*$/, '').trim();
    if (!line) return;
    if (line.startsWith(':')) {
      pendingTitle = line.slice(1).trim();
      return;
    }
    const pads: GridPad[] = [];
    for (const token of line.split(/[\s,;|]+/).filter(Boolean)) {
      if (EMPTY.has(token)) {
        pads.push({ cell: null, token });
      } else if (token === '%') {
        const prev = [...pads].reverse().find((p) => p.cell);
        if (prev) pads.push({ ...prev });
        else errors.push(`Ligne ${li + 1} : « % » sans accord avant.`);
      } else {
        const cell = parseChord(token);
        if (cell) pads.push({ cell, token });
        else errors.push(`Ligne ${li + 1} : accord inconnu « ${token} ».`);
      }
    }
    if (pads.length) {
      rows.push({ title: pendingTitle, pads });
      pendingTitle = undefined;
    }
  });

  return { rows, errors };
}

const wrap = (n: number) => ((n % 12) + 12) % 12;

// Voicing serré : toutes les classes de hauteur de l'accord ramenées dans
// l'octave [base, base+12). Pour un accord slash (C/E), on part de la basse :
// elle est la note la plus grave, les autres s'empilent au-dessus (< 1 octave).
export function compactVoicing(cell: ChordCell, transpose: number, base: number): number[] {
  const rootPc = wrap(cell.root + transpose);
  const pcs = [...new Set(cell.intervals.map((iv) => wrap(rootPc + iv)))];
  if (cell.bass === undefined) {
    return pcs.map((pc) => base + wrap(pc - base)).sort((a, b) => a - b);
  }
  const bassPc = wrap(cell.bass + transpose);
  const bassNote = base + wrap(bassPc - base);
  const notes = new Set([bassNote, ...pcs.map((pc) => bassNote + wrap(pc - bassPc))]);
  return [...notes].sort((a, b) => a - b);
}

export function padLabel(cell: ChordCell, transpose: number): string {
  return labelFor(cell, transpose).name;
}

export const DEFAULT_GRID = `:Couplet
C | G | Am | F
C | G | F  | C
:Refrain
F | G | Em | Am
Dm7 | G7 | C | C/E`;
