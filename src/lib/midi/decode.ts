// Description lisible d'un message MIDI brut (pour le moniteur).

const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const noteName = (n: number) => `${NOTE[n % 12]}${Math.floor(n / 12) - 1}`;

const CC: Record<number, string> = {
  0: 'Bank MSB', 1: 'Modulation', 5: 'Portamento time', 6: 'Data entry', 7: 'Volume',
  10: 'Pan', 11: 'Expression', 32: 'Bank LSB', 64: 'Sustain', 65: 'Portamento',
  66: 'Sostenuto', 67: 'Soft', 80: 'Reverb prog.', 81: 'Chorus prog.', 91: 'Reverb',
  93: 'Chorus', 98: 'NRPN LSB', 99: 'NRPN MSB', 100: 'RPN LSB', 101: 'RPN MSB',
  120: 'All sound off', 121: 'Reset ctrl', 122: 'Local', 123: 'All notes off'
};

const REALTIME: Record<number, string> = {
  0xf8: 'Clock', 0xfa: 'Start', 0xfb: 'Continue', 0xfc: 'Stop', 0xfe: 'Active sensing', 0xff: 'Reset'
};

export const hex = (bytes: number[]) =>
  bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

export function describe(bytes: number[]): string {
  const [s, d1 = 0, d2 = 0] = bytes;
  if (s >= 0xf0) {
    if (s === 0xf0) return `SysEx (${bytes.length} octets)`;
    if (s === 0xf2) return `Song position ${d1 | (d2 << 7)}`;
    if (s === 0xf3) return `Song select ${d1}`;
    return REALTIME[s] ?? 'Système';
  }
  const ch = (s & 0x0f) + 1;
  switch (s & 0xf0) {
    case 0x80: return `ch${ch} Note off ${noteName(d1)}`;
    case 0x90: return d2 ? `ch${ch} Note on ${noteName(d1)} v${d2}` : `ch${ch} Note off ${noteName(d1)}`;
    case 0xa0: return `ch${ch} Poly AT ${noteName(d1)} ${d2}`;
    case 0xb0: return `ch${ch} CC${d1}${CC[d1] ? ' ' + CC[d1] : ''} = ${d2}`;
    case 0xc0: return `ch${ch} Program ${d1 + 1}`;
    case 0xd0: return `ch${ch} Channel AT ${d1}`;
    case 0xe0: return `ch${ch} Pitch bend ${(d1 | (d2 << 7)) - 8192}`;
  }
  return '?';
}

// "F0 7E 7F 06 01 F7" / "fa" / "b0,07,64" -> octets. null si invalide.
export function parseHex(text: string): number[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return null;
  const bytes = parts.map((p) => parseInt(p.replace(/^0x/i, ''), 16));
  if (bytes.some((b) => isNaN(b) || b < 0 || b > 255)) return null;
  if (bytes[0] < 0x80) return null; // doit commencer par un octet de statut
  return bytes;
}
