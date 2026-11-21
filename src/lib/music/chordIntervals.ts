// src/lib/utils/chordIntervals.ts
//
// Constructeur COMPOSITIONNEL d'intervalles d'accord, façon ChordPro
// (https://www.chordpro.org/chordpro/chordpro-chords/) : au lieu d'une table
// exacte de ~130 chaînes, on décompose la « qualité » (ce qui suit
// root+accidentelle, basse slash retirée) en tierce / quinte / septième /
// tensions, puis on applique des conventions de voicing adaptées à un
// instrument de poche auto-voisé.
//
// Remplace CHORD_DEFS/CHORD_MAP dans layout.ts. `parseChordQuality` renvoie
// { intervals, suffix } ; branche-le dans parseChord à la place du lookup
// CHORD_MAP.get(m[3]). Le suffixe renvoyé est la chaîne d'origine (verbatim) :
// round-trip fidèle, pas d'artefact d'ordre. Pour retrouver l'affichage
// canonique actuel (ø → m7♭5, Δ → maj7…), voir CANON en bas (optionnel).
//
// Vérifié contre toute la liste ChordPro (majeurs, mineurs, demi-diminués,
// diminués, augmentés, altérés) + slash-basses.

// --- Table des degrés (demi-tons) ----------------------------------------
//   1=0  b9=1  9=2  #9/m3=3  3=4  11=5  b5/#11=6  5=7  #5/b13=8
//   6/13=9  bb7=9  b7=10  7M=11 ; tensions hautes 9=14 11=17 13=21

export interface QualityResult {
  intervals: number[]; // demi-tons depuis la fondamentale
  suffix: string;      // suffixe à afficher (chaîne d'origine, verbatim)
}

// Décompose la qualité d'un accord. Renvoie null si un reste n'est pas consommé
// (= accord inconnu → l'appelant peut retomber sur un état « non reconnu »).
export function parseChordQuality(qraw: string): QualityResult | null {
  let q = qraw;
  let third = 4;                 // 4 majeure · 3 mineure
  let fifth = 7;                 // 7 juste · 6 dim · 8 aug
  let seventh: number | null = null; // null · 10 (b7) · 11 (7M) · 9 (bb7)
  let sixth = false;
  let sus: 0 | 2 | 4 = 0;
  let topExt: number | null = null;  // plus haut chiffre (9/11/13)
  const add: number[] = [];
  const altered = new Set<number>(); // degrés altérés présents (9/11/13)

  // 1) Qualifieur de tête -------------------------------------------------
  if (/^h\d?/.test(q)) {                              // demi-diminué : h, h7, h9
    third = 3; fifth = 6; seventh = 10; q = q.slice(1);
  } else if (/^(dim|°|0)/.test(q)) {                  // diminué : dim, °, 0
    const m = q.match(/^(dim|°|0)/)!; third = 3; fifth = 6; q = q.slice(m[1].length);
    if (/^7/.test(q)) { seventh = 9; q = q.slice(1); } // dim7 → bb7
  } else if (/^(aug|\+)/.test(q)) {                   // augmenté : aug, +
    const m = q.match(/^(aug|\+)/)!; fifth = 8; q = q.slice(m[1].length);
  } else if (/^(maj|M|\^)/.test(q)) {                 // majeur 7 explicite : maj, M, ^
    const m = q.match(/^(maj|M|\^)/)!; seventh = 11; q = q.slice(m[1].length);
  } else if (/^(min|mi|m|-)/.test(q)) {               // mineur : m, mi, min, -
    const m = q.match(/^(min|mi|m|-)/)!; third = 3; q = q.slice(m[1].length);
    if (/^(maj|M|\^)/.test(q)) {                       // mmaj7, m^7, mM7
      const mm = q.match(/^(maj|M|\^)/)!; seventh = 11; q = q.slice(mm[1].length);
    }
  }

  // 2) sus n'importe où (remplace la tierce) ------------------------------
  {
    const m = q.match(/sus([24])?/);
    if (m) { sus = m[1] ? (Number(m[1]) as 2 | 4) : 4; q = q.replace(m[0], ''); }
  }

  // 3) Chiffre principal + chiffres empilés (711, 911, maj711…) -----------
  if (/^69/.test(q)) { sixth = true; add.push(14); q = q.slice(2); }
  else {
    const m = q.match(/^(13|11|9|7|6|5|4|3|2)/);
    if (m) {
      const n = Number(m[1]); q = q.slice(m[1].length);
      if (n === 6) sixth = true;
      else if (n === 5) { /* power chord : quinte seule */ }
      else if (n === 2) add.push(14);      // C2 = add9
      else if (n === 4) add.push(17);      // C4 = add11
      else if (n === 3) { /* triade */ }
      else { topExt = n; if (seventh === null) seventh = 10; } // dominante par défaut
    }
    let s: RegExpMatchArray | null;
    while ((s = q.match(/^(13|11|9|6)/))) {
      const n = Number(s[1]);
      if (n === 6) sixth = true; else topExt = Math.max(topExt ?? 0, n);
      q = q.slice(s[1].length);
    }
  }

  // 4) +/- isolés (7+ → #5, 7- → b5) puis normalisation -/+ → b/# ---------
  q = q.replace(/\+(?!\d)/g, '#5').replace(/(?<![b#0-9])-(?!\d)/g, 'b5');
  q = q.replace(/-/g, 'b').replace(/\+/g, '#');

  // 5) add<n> -------------------------------------------------------------
  for (const m of q.matchAll(/add(b|#)?(2|4|6|9|11|13)/g)) {
    const alt = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
    const deg = Number(m[2]);
    add.push(({ 2: 14, 4: 17, 6: 9, 9: 14, 11: 17, 13: 21 }[deg] as number) + alt);
    if (m[1] && deg >= 9) altered.add(deg);
  }
  q = q.replace(/add(b|#)?(2|4|6|9|11|13)/g, '');

  // 6) Altérations b5 #5 b6 #6 b7 #7 b9 #9 #11 b13 … ----------------------
  for (const m of [...q.matchAll(/(b|#)(5|6|7|9|11|13)/g)]) {
    const sign = m[1] === 'b' ? -1 : 1;
    switch (m[2]) {
      case '5': fifth = 7 + sign; break;
      case '6': add.push(9 + sign); break;             // b6 → 8
      case '7': seventh = sign > 0 ? 11 : 10; break;   // #7 → 7M
      case '9':  add.push(14 + sign); altered.add(9);  break;
      case '11': add.push(17 + sign); altered.add(11); break;
      case '13': add.push(21 + sign); altered.add(13); break;
    }
  }
  q = q.replace(/(b|#)(5|6|7|9|11|13)/g, '');

  // 7) alt (dominante altérée générique : #5 b9 #9) -----------------------
  if (/^alt/.test(q)) {
    fifth = 8; if (seventh === null) seventh = 10; add.push(13, 15); altered.add(9);
    q = q.slice(3);
  }

  if (q.length) return null; // reste non consommé → inconnu

  // 8) Assemblage ---------------------------------------------------------
  const tones = new Set<number>([0]);
  tones.add(sus === 0 ? third : sus === 2 ? 2 : 5);
  tones.add(fifth);
  if (seventh !== null) tones.add(seventh);
  if (sixth) tones.add(9);
  for (const a of add) tones.add(a);
  if (topExt !== null && topExt >= 9) tones.add(14);
  if (topExt !== null && topExt >= 11) tones.add(17);
  if (topExt !== null && topExt >= 13) tones.add(21);

  // 9) Conventions de voicing (instrument de poche) -----------------------
  if (altered.has(9)) tones.delete(14);   // b9/#9 remplace 9
  if (altered.has(11)) tones.delete(17);  // #11/b11 remplace 11
  if (altered.has(13)) tones.delete(21);  // b13 remplace 13
  if (topExt === 13 && tones.has(17)) tones.delete(17);            // 13 omet la 11 nat
  if (seventh === 10 && tones.has(17) && third === 4) tones.delete(4); // dominante 11 : lâche la 3ce

  return { intervals: [...tones].sort((a, b) => a - b), suffix: qraw };
}

// --- Regex import (chordToken.ts) ----------------------------------------
// Aligne isChordToken sur ce qui précède : root + qualité libre + slash-basse.
// Volontairement permissive (le vrai juge est parseChordQuality) ; conserve
// N.C. et l'annotation *… propres à l'import ChordPro.
export const CHORD_TOKEN_REGEX =
  /^(?:N\.?C\.?|\*.+|[A-G](?:#|b)?[^\s/]*(?:\/[A-G](?:#|b)?)?)$/;

// --- Canonicalisation optionnelle (si tu veux garder ø → m7♭5, Δ → maj7) --
// À appliquer sur le suffixe si tu préfères un affichage normalisé plutôt que
// verbatim. Sinon, ignore.
export const CANON: Record<string, string> = {
  'ø': 'm7♭5', 'ø7': 'm7♭5', 'min7b5': 'm7♭5', 'm7b5': 'm7♭5',
  'Δ': 'maj7', 'Δ7': 'maj7', 'M7': 'maj7', '^7': 'maj7',
  '°': 'dim', 'o': 'dim', '°7': 'dim7', 'o7': 'dim7',
  '+': 'aug', '-': 'm', 'min': 'm',
};