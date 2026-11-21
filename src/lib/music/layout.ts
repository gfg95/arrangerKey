// src/lib/utils/layout.ts
// Diagramme du clavier + parseur du format texte personnalisable.
//
// Format texte (référence : do) :
//   - 3 lignes, une par rangée.
//   - chaque ligne = 6 éléments : 3 notes puis 3 accords.
//   - séparateurs : virgule, point-virgule ou espaces.
//   - commentaires : tout ce qui suit # ou // est ignoré ; lignes vides OK.
//
// Notes  : notation française (do ré mi fa sol la si), avec dièse # ou bémol b.
//          octave : chiffre (do3, sol2) ou marqueur relatif (do(-1), la(+1)).
//          Sans marqueur, l'octave par défaut est 3 (do3 = C3).
// Accords : notation américaine (C, Em, G7, Bm7b5, Dm7, Fmaj7, C#dim7…).
//          Les accords sont voisés automatiquement (octave fixe) ; leur hauteur
//          exacte importe peu, seule compte la transposition.
//
// Enharmonie (b vs #) : une cellule ne mémorise que la classe de hauteur, plus
// une orthographe *optionnelle* `acc` ('sharp' | 'flat') captée à la saisie /
// import. Toute la génération de noms passe par une couture unique, pcName(),
// qui applique — dans l'ordre — l'accidentelle source (uniquement en tonalité de
// référence), puis une POLITIQUE. Niveau 1 : table neutre fixe. Niveau 2 (à
// venir) : direction dièse/bémol déduite de la tonalité (une ligne à changer
// dans pcName, cf. NEUTRAL_ACC).


import { parseChordQuality } from "./chordIntervals"

// --- Tables de noms (dièses et bémols), indexées par classe de hauteur -------
const FR_SHARP = ['do', 'do#', 'ré', 'ré#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'] as const;
const FR_FLAT  = ['do', 'réb', 'ré', 'mib', 'mi', 'fa', 'solb', 'sol', 'lab', 'la', 'sib', 'si'] as const;
const EN_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const EN_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

// Classes de hauteur des noms saisis.
const FR_PC: Record<string, number> = {
  do: 0, ré: 2, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11,
};
const EN_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

// --- Types ---------------------------------------------------------------

// Orthographe d'une note noire : dièse ou bémol.
export type Spelling = 'sharp' | 'flat';

export interface NoteCell {
  kind: 'note';
  midi: number;
  acc?: Spelling; // orthographe saisie (référence do) ; absente = laisser la politique décider
}

export interface ChordCell {
  kind: 'chord';
  root: number;        // MIDI de la fondamentale (octave 3)
  intervals: number[]; // demi-tons depuis la fondamentale
  suffix: string;      // suffixe américain affiché (verbatim)
  acc?: Spelling;      // orthographe de la fondamentale (référence do)
  bass?: number;       // MIDI de la basse slash (octave 2), si accord « C/E »
  bassAcc?: Spelling;  // orthographe de la basse (référence do)
}

// Emplacement réservé (vide) : rien à jouer, sert à de futures fonctions.
export interface EmptyCell {
  kind: 'empty';
}

export type Cell = NoteCell | ChordCell | EmptyCell;

// Un "pad" = cellule prête à afficher (cellule + id stable + touche clavier).
export interface Pad {
  cell: Cell;
  id: string;
  keyHint: string;
}

export interface CellLabel {
  name: string;
  sub: string;
}

// --- Qualités d'accord ---------------------------------------------------

// Alias saisis -> intervalles + suffixe affiché. La casse compte (M7 ≠ m7).
const CHORD_DEFS: Array<[string[], number[], string]> = [
  [[''], [0, 4, 7], ''],
  [['m', 'min', '-'], [0, 3, 7], 'm'],
  [['7'], [0, 4, 7, 10], '7'],
  [['maj7', 'M7', 'Δ', 'Δ7'], [0, 4, 7, 11], 'maj7'],
  [['m7', 'min7', '-7'], [0, 3, 7, 10], 'm7'],
  [['m7b5', 'm7♭5', 'min7b5', 'ø', 'ø7'], [0, 3, 6, 10], 'm7♭5'],
  [['dim', '°'], [0, 3, 6], '°'],
  [['dim7', '°7'], [0, 3, 6, 9], '°7'],
  [['6'], [0, 4, 7, 9], '6'],
  [['m6', 'min6'], [0, 3, 7, 9], 'm6'],
  [['9'], [0, 4, 7, 10, 14], '9'],
  [['maj9', 'M9'], [0, 4, 7, 11, 14], 'maj9'],
  [['m9', 'min9'], [0, 3, 7, 10, 14], 'm9'],
  [['sus2'], [0, 2, 7], 'sus2'],
  [['sus4', 'sus'], [0, 5, 7], 'sus4'],
  [['aug', '+'], [0, 4, 8], '+'],
];

const CHORD_MAP = new Map<string, { intervals: number[]; suffix: string }>();
for (const [aliases, intervals, suffix] of CHORD_DEFS) {
  for (const alias of aliases) CHORD_MAP.set(alias, { intervals, suffix });
}

// --- Parsing ------------------------------------------------------------

const accidental = (s: string): number =>
  s === '#' || s === '♯' ? 1 : s === 'b' || s === '♭' ? -1 : 0;

// Accidentelle saisie -> orthographe mémorisée (undefined si aucune).
const accSpelling = (s: string): Spelling | undefined =>
  s === '#' || s === '♯' ? 'sharp' : s === 'b' || s === '♭' ? 'flat' : undefined;

const wrap = (pc: number): number => ((pc % 12) + 12) % 12;

// Jetons signifiant « case vide » (emplacement réservé).
const EMPTY_TOKENS = new Set(['vide', '-', '_', '.', '·']);
const isEmptyToken = (t: string): boolean => EMPTY_TOKENS.has(t.toLowerCase());

function parseNote(token: string): NoteCell | null {
  const m = token
    .toLowerCase()
    .match(/^(do|ré|re|mi|fa|sol|la|si)([#♯b♭]?)(?:\(([+-]?\d+)\)|(-?\d+))?$/);
  if (!m) return null;
  const base = FR_PC[m[1]];
  const octave =
    m[3] !== undefined ? 3 + parseInt(m[3], 10)
    : m[4] !== undefined ? parseInt(m[4], 10)
    : 3;
  const pc = wrap(base + accidental(m[2]));
  const acc = accSpelling(m[2]);
  return acc ? { kind: 'note', midi: (octave + 1) * 12 + pc, acc } : { kind: 'note', midi: (octave + 1) * 12 + pc };
}

export function parseChord(token: string): ChordCell | null {
  const m = token.match(/^([A-Ga-g])([#♯b♭]?)([^\/]*)(?:\/([A-Ga-g])([#♯b♭]?))?$/);
  if (!m) return null;
  const base = EN_PC[m[1].toUpperCase()];
  if (base === undefined) return null;
  const q = parseChordQuality(m[3]);
  if (!q) return null;
  const pc = wrap(base + accidental(m[2]));
  const cell: ChordCell = { kind: 'chord', root: 48 + pc, intervals: q.intervals, suffix: q.suffix };
  const acc = accSpelling(m[2]);
  if (acc) cell.acc = acc;
  if (m[4]) {
    const bb = EN_PC[m[4].toUpperCase()];
    if (bb === undefined) return null;              // basse illisible → accord rejeté
    cell.bass = 36 + wrap(bb + accidental(m[5]));   // octave 2, sous la fondamentale
    const bAcc = accSpelling(m[5]);
    if (bAcc) cell.bassAcc = bAcc;
  }
  return cell;
}

export interface ParseResult {
  rows: Cell[][] | null;
  errors: string[];
}

// Analyse le texte de layout. Renvoie rows=null si la moindre erreur, avec des
// messages lisibles (aucune modification appliquée en cas d'erreur).
export function parseLayout(text: string): ParseResult {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    // Commentaires : // n'importe où, et # seulement en début de ligne ou après
    // une espace (sinon on casserait les dièses comme F#).
    .map((l) => l.replace(/\/\/.*$/, '').replace(/(^|\s)#.*$/, '$1').trim())
    .filter((l) => l.length > 0);

  if (lines.length !== 3) {
    errors.push(`Il faut 3 rangées (${lines.length} trouvée(s)).`);
  }

  const rows: Cell[][] = [];
  lines.slice(0, 3).forEach((line, r) => {
    const toks = line.split(/[\s,;]+/).filter(Boolean);
    if (toks.length !== 5) {
      errors.push(`Rangée ${r + 1} : 5 éléments attendus (3 notes + 2 accords), ${toks.length} trouvé(s).`);
    }
    const cells: Cell[] = [];
    toks.forEach((tok, c) => {
      if (isEmptyToken(tok)) {
        cells.push({ kind: 'empty' });
        return;
      }
      // Majuscule initiale (A–G) = accord ; minuscule = note. Les notes et les
      // accords peuvent donc être placés n'importe où.
      const first = tok[0];
      const isChord = first >= 'A' && first <= 'Z';
      if (isChord) {
        const chord = parseChord(tok);
        if (!chord) errors.push(`Rangée ${r + 1}, colonne ${c + 1} : accord « ${tok} » non reconnu.`);
        else cells.push(chord);
      } else {
        const note = parseNote(tok);
        if (!note) errors.push(`Rangée ${r + 1}, colonne ${c + 1} : note « ${tok} » non reconnue.`);
        else cells.push(note);
      }
    });
    rows.push(cells);
  });

  if (errors.length > 0) return { rows: null, errors };
  return { rows, errors: [] };
}

// --- Layout strumming (5 accords) ----------------------------------------
// Mode « strumming » facon autoharp/Omnichord : 5 boutons d'accords verticaux.
// Meme balisage que l'accordeon, mais UNE seule rangee de 5 cases, uniquement
// des accords (ou « vide »). Reutilise parseChord / serializeCell / la
// transposition de texte, donc l'editeur fonctionne comme celui de l'accordeon.

export interface StrumParseResult {
  cells: Cell[] | null;
  errors: string[];
}

// Analyse une ligne de 5 accords. rows=null si la moindre erreur.
export function parseStrumLayout(text: string): StrumParseResult {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, '').replace(/(^|\s)#.*$/, '$1').trim())
    .filter((l) => l.length > 0);

  const toks = (lines[0] ?? '').split(/[\s,;]+/).filter(Boolean);
  if (toks.length !== 5) {
    errors.push(`Il faut 5 accords (${toks.length} trouve(s)).`);
  }
  const cells: Cell[] = [];
  toks.slice(0, 5).forEach((tok, c) => {
    if (isEmptyToken(tok)) {
      cells.push({ kind: 'empty' });
      return;
    }
    const chord = parseChord(tok);
    if (!chord) errors.push(`Case ${c + 1} : accord « ${tok} » non reconnu.`);
    else cells.push(chord);
  });

  if (errors.length > 0) return { cells: null, errors };
  return { cells, errors: [] };
}

// --- Layout par défaut (reproduit le diagramme d'origine) ----------------

export const DEFAULT_LAYOUT_TEXT = `re, sol, G, mi, Em
mi, do, C, la, Am
la, fa, F, re, Dm`;

export const DEFAULT_LAYOUT_TEXT2 = `F, C, G, Dm, Am
fa, do, sol, re, la
la, mi, si, fa, do`;

export const DEFAULT_LAYOUT: Cell[][] = parseLayout(DEFAULT_LAYOUT_TEXT).rows ?? [];
export const DEFAULT_LAYOUT2: Cell[][] = parseLayout(DEFAULT_LAYOUT_TEXT2).rows ?? [];

// Dispositions strumming par defaut (une par soufflet). 5 accords chacune.
export const DEFAULT_STRUM_TEXT = `C  G  Am  F  Dm`;
export const DEFAULT_STRUM_TEXT2 = `G  D  Em  C  Am`;
export const DEFAULT_STRUM_LAYOUT: Cell[] = parseStrumLayout(DEFAULT_STRUM_TEXT).cells ?? [];
export const DEFAULT_STRUM_LAYOUT2: Cell[] = parseStrumLayout(DEFAULT_STRUM_TEXT2).cells ?? [];

// --- Couture d'orthographe (b vs #) --------------------------------------
// Point de génération UNIQUE des noms de notes/accords. Tous les autres codes
// (labelFor, serializeCell, transposeChordName) passent par ici.

// Touches blanches : nom unique (dièse = bémol).
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);

// NIVEAU 1 — politique neutre fixe pour les 5 touches noires :
//   do#(1)  mib(3)  fa#(6)  sol#(8)  sib(10)
// NIVEAU 2 (à venir) — remplacer la lecture de NEUTRAL_ACC dans pcName par
//   keyDirection(opts.keyPc, opts.mode) : dièses pour les tonalités dièse,
//   bémols pour les tonalités bémol, cette table restant le cas neutre (do/Am).
const NEUTRAL_ACC: Record<number, Spelling> = {
  1: 'sharp', // do# / C#
  3: 'flat', // mib / Eb
  6: 'sharp', // fa# / F#
  8: 'sharp', // sol# / G#
  10: 'flat', // sib / Bb
};

interface SpellOpts {
  en: boolean; // true = anglais (accords), false = français (notes)
  acc?: Spelling; // accidentelle source, prioritaire si fournie
  keyPc?: number; // classe de hauteur de la tonalité affichée (pour le niveau 2)
  mode?: 'maj' | 'min'; // mode de la tonalité (pour le niveau 2)
}

// NIVEAU 2 — direction dièse/bémol par tonalité MAJEURE (cycle des quintes),
// indexée par classe de hauteur de la tonique. undefined = cas neutre (do majeur)
// -> on retombe alors sur NEUTRAL_ACC. Pour un pc ambigu (fa#/solb, do#/réb…),
// on choisit l'orthographe conventionnelle (moins d'altérations).
const MAJOR_KEY_DIR: Record<number, Spelling> = {
  1: 'flat',   // Réb
  2: 'sharp',  // Ré
  3: 'flat',   // Mib
  4: 'sharp',  // Mi
  5: 'flat',   // Fa
  6: 'sharp',  // Fa#
  7: 'sharp',  // Sol
  8: 'flat',   // Lab
  9: 'sharp',  // La
  10: 'flat',  // Sib
  11: 'sharp', // Si
  // 0 (do) absent -> undefined -> cas neutre.
};

// Direction d'orthographe déduite de la tonalité. Un mode mineur emprunte à sa
// relative majeure (tonique + 3 demi-tons) : la mineur -> do majeur, etc.
function keyDirection(keyPc?: number, mode?: 'maj' | 'min'): Spelling | undefined {
  if (keyPc === undefined) return undefined;
  const majPc = mode === 'min' ? wrap(keyPc + 3) : wrap(keyPc);
  return MAJOR_KEY_DIR[majPc];
}

function pcName(pc: number, opts: SpellOpts): string {
  const p = wrap(pc);
  const sharp = opts.en ? EN_SHARP : FR_SHARP;
  const flat = opts.en ? EN_FLAT : FR_FLAT;
  if (WHITE.has(p)) return sharp[p]; // touche blanche : nom unique

  // Priorité : 1) accidentelle source ; 2) tonalité (niveau 2) ; 3) table neutre.
  const acc: Spelling =
    opts.acc ?? keyDirection(opts.keyPc, opts.mode) ?? NEUTRAL_ACC[p] ?? 'sharp';
  return (acc === 'flat' ? flat : sharp)[p];
}

// --- Affichage / lecture -------------------------------------------------

const octaveOf = (m: number): number => Math.floor(m / 12) - 1;

export function labelFor(cell: Cell, transpose = 0): CellLabel {
  if (cell.kind === 'empty') return { name: '', sub: '' };
  const acc = transpose === 0 ? cell.acc : undefined;
  const keyPc = wrap(transpose);
  if (cell.kind === 'note') {
    const m = cell.midi + transpose;
    return { name: pcName(wrap(m), { en: false, acc, keyPc }), sub: String(octaveOf(m)) };
  }
  const m = cell.root + transpose;
  let name = pcName(wrap(m), { en: true, acc, keyPc }) + cell.suffix;
  if (cell.bass !== undefined) {
    const bAcc = transpose === 0 ? cell.bassAcc : undefined;
    name += '/' + pcName(wrap(cell.bass + transpose), { en: true, acc: bAcc, keyPc });
  }
  return { name, sub: '' };
}

export function midisFor(cell: Cell, transpose = 0): number[] {
  if (cell.kind === 'note') return [cell.midi + transpose];
  if (cell.kind === 'chord') {
    const notes = cell.intervals.map((iv) => cell.root + iv + transpose);
    return cell.bass !== undefined ? [cell.bass + transpose, ...notes] : notes;
  }
  return [];
}

// --- Sérialisation + intégration Property 'bass' does not exist on type 'ChordCell'dans une chanson ------------------------
// Réciproque du parseur : réécrit les dispositions vers le balisage texte,
// puis les injecte dans un fichier chanson (format SongRoller). Chaque rangée
// de layout est préfixée « .. » : SongRoller ignore ces métadonnées inconnues,
// et l'aller-retour repasse par parseChord/parseNote sans perte.

// Une cellule -> jeton texte (référence do, sans transposition). L'orthographe
// saisie (acc) est préservée, donc « mib » reste « mib », « Bb » reste « Bb »
// (round-trip idempotent).
function serializeCell(cell: Cell): string {
  if (cell.kind === 'empty') return 'vide';
  if (cell.kind === 'note') {
    const name = pcName(wrap(cell.midi), { en: false, acc: cell.acc, keyPc: 0 });
    const oct = octaveOf(cell.midi);
    return oct === 3 ? name : `${name}${oct}`;
  }
  let s = pcName(wrap(cell.root), { en: true, acc: cell.acc, keyPc: 0 }) + cell.suffix;
  if (cell.bass !== undefined) {
    s += '/' + pcName(wrap(cell.bass), { en: true, acc: cell.bassAcc, keyPc: 0 });
  }
  return s;
}

// Une disposition -> texte multi-lignes (une ligne par rangée), sans préfixe.
export function serializeLayout(rows: Cell[][]): string {
  return rows.map((row) => row.map(serializeCell).join('  ')).join('\n');
}

// Une disposition strumming (5 cellules) -> une ligne, sans prefixe.
export function serializeStrumLayout(cells: Cell[]): string {
  return cells.map(serializeCell).join('  ');
}

// En-tête d'un bloc : « .. layout, pull » ou « .. layout, push ».
const LAYOUT_HEADER = /^\.\.\s*layout\s*,\s*(pull|push)\b/i;

// Vrai si la ligne est une rangée de layout (préfixe « .. » + jetons valides).
// Le garde startsWith('..') est indispensable : sans lui, une parole comme
// « la la la » (notes valides) serait avalée par le bloc.
function isLayoutRowLine(line: string): boolean {
  const t = line.trimStart();
  if (!t.startsWith('..')) return false;
  const toks = t.slice(2).trim().split(/[\s,;]+/).filter(Boolean);
  if (toks.length === 0) return false;
  return toks.every((tok) =>
    isEmptyToken(tok)
      ? true
      : tok[0] >= 'A' && tok[0] <= 'Z'
        ? parseChord(tok) !== null
        : parseNote(tok) !== null,
  );
}

// Retire les blocs layout existants d'une chanson et réinsère ceux fournis,
// juste après les métadonnées « .. » de tête. Un layout null/absent est omis.
export function injectLayouts(
  songText: string,
  layouts: { pull?: Cell[][] | null; push?: Cell[][] | null },
): string {
  const src = songText.split(/\r?\n/);
  const kept: string[] = [];

  // 1. Enlève les anciens blocs (en-tête + rangées « .. » qui suivent).
  for (let i = 0; i < src.length; i++) {
    if (LAYOUT_HEADER.test(src[i])) {
      i++;
      while (i < src.length && isLayoutRowLine(src[i])) i++;
      i--; // la ligne courante n'appartient pas au bloc : on la reverra.
      continue;
    }
    kept.push(src[i]);
  }

  // 2. Sérialise les nouveaux blocs.
  const blocks: string[] = [];
  for (const [name, rows] of [
    ['pull', layouts.pull],
    ['push', layouts.push],
  ] as const) {
    if (!rows) continue;
    blocks.push(`.. layout, ${name}`);
    for (const row of rows) blocks.push('.. ' + row.map(serializeCell).join('  '));
  }
  if (blocks.length === 0) return kept.join('\n');

  // 3. Insère après la première grappe de métadonnées « .. » de tête.
  let at = 0;
  while (at < kept.length && kept[at].trimStart().startsWith('..')) at++;
  return [...kept.slice(0, at), '', ...blocks, '', ...kept.slice(at)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n'); // évite les trous de lignes vides
}

// Lit les blocs « .. layout, pull/push » d'une chanson et renvoie, pour chacun,
// le texte des rangées prêt pour parseLayout (préfixe « .. » retiré). C'est le
// pendant lecture de injectLayouts. Renvoie null pour un bloc absent.
export function extractLayoutBlocks(text: string): { pull: string | null; push: string | null } {
  const src = text.split(/\r?\n/);
  const res: { pull: string | null; push: string | null } = { pull: null, push: null };
  for (let i = 0; i < src.length; i++) {
    const h = src[i].trimStart().match(LAYOUT_HEADER);
    if (!h) continue;
    const which = h[1].toLowerCase() as 'pull' | 'push';
    const rows: string[] = [];
    let j = i + 1;
    while (j < src.length && isLayoutRowLine(src[j])) {
      rows.push(src[j].trimStart().slice(2).trim()); // enlève le « .. »
      j++;
    }
    if (rows.length) res[which] = rows.join('\n');
    i = j - 1;
  }
  return res;
}

// --- Blocs strumming « .. strum, pull/push » ------------------------------
// Pendant du couple injectLayouts/extractLayoutBlocks, pour la disposition
// strumming (une ligne de 5 accords). En-tête distinct, une seule rangée.

const STRUM_HEADER = /^\.\.\s*strum\s*,\s*(pull|push)\b/i;

// Vrai si la ligne est une rangée strumming : préfixe « .. » + jetons accords
// ou « vide » uniquement (jamais de notes en strumming).
function isStrumRowLine(line: string): boolean {
  const t = line.trimStart();
  if (!t.startsWith('..')) return false;
  const toks = t.slice(2).trim().split(/[\s,;]+/).filter(Boolean);
  if (toks.length === 0) return false;
  return toks.every((tok) => isEmptyToken(tok) || parseChord(tok) !== null);
}

// Retire les blocs strumming existants et réinsère ceux fournis, après la
// grappe « .. » de tête. Un soufflet null/absent est omis.
export function injectStrumLayouts(
  songText: string,
  layouts: { pull?: Cell[] | null; push?: Cell[] | null },
): string {
  const src = songText.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < src.length; i++) {
    if (STRUM_HEADER.test(src[i])) {
      i++;
      while (i < src.length && isStrumRowLine(src[i])) i++;
      i--;
      continue;
    }
    kept.push(src[i]);
  }

  const blocks: string[] = [];
  for (const [name, cells] of [
    ['pull', layouts.pull],
    ['push', layouts.push],
  ] as const) {
    if (!cells) continue;
    blocks.push(`.. strum, ${name}`);
    blocks.push('.. ' + serializeStrumLayout(cells));
  }
  if (blocks.length === 0) return kept.join('\n');

  let at = 0;
  while (at < kept.length && kept[at].trimStart().startsWith('..')) at++;
  return [...kept.slice(0, at), '', ...blocks, '', ...kept.slice(at)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// Lit les blocs « .. strum, pull/push » : renvoie, pour chacun, la ligne de 5
// accords (préfixe « .. » retiré), prête pour parseStrumLayout. null si absent.
export function extractStrumBlocks(text: string): { pull: string | null; push: string | null } {
  const src = text.split(/\r?\n/);
  const res: { pull: string | null; push: string | null } = { pull: null, push: null };
  for (let i = 0; i < src.length; i++) {
    const h = src[i].trimStart().match(STRUM_HEADER);
    if (!h) continue;
    const which = h[1].toLowerCase() as 'pull' | 'push';
    const rows: string[] = [];
    let j = i + 1;
    while (j < src.length && isStrumRowLine(src[j])) {
      rows.push(src[j].trimStart().slice(2).trim());
      j++;
    }
    if (rows.length) res[which] = rows.join('\n');
    i = j - 1;
  }
  return res;
}

// Transpose le NOM d'un accord de `semitones` demi-tons, en préservant son
// suffixe et son éventuelle basse (accord slash « C/E »). Sert à afficher les
// accords de la chanson dans la tonalité choisie : affiché = écrit + transposition.
// Transposition 0 -> chaîne renvoyée telle quelle (on garde l'orthographe
// d'origine, bémols compris). Sinon, la fondamentale est respellée par la
// politique (pcName), cohérente avec labelFor et serializeCell.
export function transposeChordName(chord: string, semitones: number): string {
  if (!chord || semitones === 0) return chord;
  return chord
    .split('/')
    .map((part) => {
      const m = part.match(/^([A-Ga-g])([#♯b♭]?)(.*)$/);
      if (!m) return part;
      const base = EN_PC[m[1].toUpperCase()];
      if (base === undefined) return part;
      const pc = wrap(base + accidental(m[2]) + semitones);
      return pcName(pc, { en: true, keyPc: wrap(semitones) }) + m[3];
    })
    .join('/');
}

// Lit un bloc « .. <header> » suivi de lignes « .. <clé> <valeur> ». Renvoie la
// map clé->valeur (valeur = texte après la 1re espace). S'arrête à la 1re ligne
// non « .. ». Générique : sert aux blocs arrangeur (arp) et batterie (drums).
export function extractPrefixedBlock(
  text: string,
  header: string,
): Record<string, string> | null {
  const src = text.split(/\r?\n/);
  const hdr = new RegExp(`^\\.\\.\\s*${header}\\s*$`, 'i');
  for (let i = 0; i < src.length; i++) {
    if (!hdr.test(src[i].trim())) continue;
    const out: Record<string, string> = {};
    let j = i + 1;
    while (j < src.length && src[j].trimStart().startsWith('..')) {
      const body = src[j].trimStart().slice(2).trim();
      const sp = body.search(/\s/);
      if (sp > 0) out[body.slice(0, sp)] = body.slice(sp + 1).trim();
      j++;
    }
    return out;
  }
  return null;
}

// Variante par soufflet de extractPrefixedBlock : lit « .. <header>, pull » et
// « .. <header>, push ». Un bloc sans direction (format hérité) est rangé dans
// « pull ». Renvoie null pour un soufflet absent. Sert aux blocs arp et drums.
export function extractPrefixedBlocksByBellow(
  text: string,
  header: string,
): { pull: Record<string, string> | null; push: Record<string, string> | null } {
  const src = text.split(/\r?\n/);
  const hdr = new RegExp(`^\\.\\.\\s*${header}\\s*(?:,\\s*(pull|push))?\\s*$`, 'i');
  const res: { pull: Record<string, string> | null; push: Record<string, string> | null } = {
    pull: null,
    push: null,
  };
  for (let i = 0; i < src.length; i++) {
    const m = src[i].trim().match(hdr);
    if (!m) continue;
    const which = (m[1]?.toLowerCase() as 'pull' | 'push') ?? 'pull'; // sans direction -> pull
    const out: Record<string, string> = {};
    let j = i + 1;
    while (j < src.length && src[j].trimStart().startsWith('..') && !hdr.test(src[j].trim())) {
      const body = src[j].trimStart().slice(2).trim();
      const sp = body.search(/\s/);
      if (sp > 0) out[body.slice(0, sp)] = body.slice(sp + 1).trim();
      j++;
    }
    res[which] = out;
    i = j - 1;
  }
  return res;
}

// Retire un bloc « .. <header> » (direction optionnelle « , pull|push ») et ses
// lignes « .. » (pour réécriture propre). Gère les blocs directionnés
// consécutifs : l'en-tête suivant arrête l'absorption. Rétrocompatible avec un
// bloc sans direction.
export function stripPrefixedBlock(lines: string[], header: string): string[] {
  const hdr = new RegExp(`^\\.\\.\\s*${header}\\s*(?:,\\s*(?:pull|push))?\\s*$`, 'i');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (hdr.test(lines[i].trim())) {
      i++;
      while (i < lines.length && lines[i].trimStart().startsWith('..') && !hdr.test(lines[i].trim())) i++;
      i--;
      continue;
    }
    kept.push(lines[i]);
  }
  return kept;
}

// Transpose NOTES et ACCORDS d'un texte de layout de `semitones` demi-tons, en
// préservant commentaires, espaces, séparateurs et jetons « vide ». Le fichier
// reste en référence do : on transpose seulement pour l'affichage/édition.
//   Aller  : transposeLayoutText(texteRéférenceDo, +transpose)
//   Retour : transposeLayoutText(texteAffiché,     -transpose)  puis applyLayout
export function transposeLayoutText(text: string, semitones: number): string {
  if (!semitones) return text; // transpose 0 -> identité (édition fidèle en do)
  return text
    .split(/\r?\n/)
    .map((line) => {
      const [code, comment] = splitLayoutComment(line);
      return code.replace(/[^\s,;]+/g, (tok) => transposeLayoutToken(tok, semitones)) + comment;
    })
    .join('\n');
}

// Coupe la ligne à son commentaire (« // » n'importe où ; « # » en début de
// ligne ou après une espace, pour ne pas casser F#). Renvoie [code, commentaire].
function splitLayoutComment(line: string): [string, string] {
  const slash = line.indexOf('//');
  const hash = line.match(/(^|\s)#/);
  const hashIdx = hash ? (hash.index ?? -1) + hash[1].length : -1;
  const cuts = [slash, hashIdx].filter((i) => i >= 0);
  if (cuts.length === 0) return [line, ''];
  const cut = Math.min(...cuts);
  return [line.slice(0, cut), line.slice(cut)];
}

// Transpose un jeton isolé (note FR ou accord US) ; laisse le reste verbatim.
function transposeLayoutToken(tok: string, semitones: number): string {
  if (isEmptyToken(tok)) return tok;
  const first = tok[0];
  if (first >= 'A' && first <= 'Z') {
    return parseChord(tok) ? transposeChordName(tok, semitones) : tok; // accord reconnu seulement
  }
  const cell = parseNote(tok);
  if (!cell) return tok; // note non reconnue -> intacte
  const m = cell.midi + semitones;
  const name = pcName(wrap(m), { en: false, keyPc: wrap(semitones) });
  const oct = octaveOf(m);
  return oct === 3 ? name : `${name}${oct}`; // octave 3 implicite
}