// Réglages de jeu persistés (localStorage).
import { DEFAULT_GRID } from '$lib/music/grid';

const KEY = 'arrangerKey.settings';

interface Data {
  gridText: string;
  transpose: number; // -11..+11
  base: number; // note MIDI la plus grave de l'octave de voicing
  latch: boolean;
  padSize: number; // px
}

const DEFAULTS: Data = { gridText: DEFAULT_GRID, transpose: 0, base: 48, latch: true, padSize: 64 };

function load(): Data {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

class Settings {
  gridText = $state(DEFAULTS.gridText);
  transpose = $state(DEFAULTS.transpose);
  base = $state(DEFAULTS.base);
  latch = $state(DEFAULTS.latch);
  padSize = $state(DEFAULTS.padSize);

  constructor() {
    Object.assign(this, load());
    $effect.root(() => {
      $effect(() => {
        const d: Data = {
          gridText: this.gridText,
          transpose: this.transpose,
          base: this.base,
          latch: this.latch,
          padSize: this.padSize
        };
        try {
          localStorage.setItem(KEY, JSON.stringify(d));
        } catch {
          /* stockage indisponible */
        }
      });
    });
  }
}

export const settings = new Settings();
