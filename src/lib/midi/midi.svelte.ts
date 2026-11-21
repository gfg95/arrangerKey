// Accès Web MIDI : liste des sorties, choix de sortie + canal, envoi de notes.
// État réactif (runes) partagé par toute l'app.

const STORAGE_KEY = 'arrangerKey.midi';

interface Saved {
  outputId?: string;
  channel?: number; // 1..16
}

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

class Midi {
  supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  status = $state<'idle' | 'ready' | 'denied' | 'unsupported'>('idle');
  error = $state('');
  outputs = $state<{ id: string; name: string }[]>([]);
  outputId = $state('');
  channel = $state(1); // 1..16 (affichage humain)

  #access: MIDIAccess | null = null;
  #sounding = new Set<number>(); // notes actuellement tenues (pour le note off / panic)

  constructor() {
    const s = load();
    if (s.outputId) this.outputId = s.outputId;
    if (s.channel && s.channel >= 1 && s.channel <= 16) this.channel = s.channel;
    if (!this.supported) this.status = 'unsupported';
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ outputId: this.outputId, channel: this.channel }));
    } catch {
      /* stockage indisponible : on ignore */
    }
  }

  async connect() {
    if (!this.supported) return;
    try {
      this.#access = await navigator.requestMIDIAccess({ sysex: false });
      this.status = 'ready';
      this.error = '';
      this.#refresh();
      this.#access.onstatechange = () => this.#refresh();
    } catch (e) {
      this.status = 'denied';
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  #refresh() {
    if (!this.#access) return;
    this.outputs = [...this.#access.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id }));
    // Garde la sortie mémorisée si elle est présente, sinon prend la première.
    if (!this.outputs.some((o) => o.id === this.outputId)) {
      this.outputId = this.outputs[0]?.id ?? '';
    }
  }

  get #out(): MIDIOutput | undefined {
    return this.outputId ? this.#access?.outputs.get(this.outputId) : undefined;
  }

  get #ch() {
    return (this.channel - 1) & 0x0f;
  }

  noteOn(notes: number[], velocity = 100) {
    const out = this.#out;
    if (!out) return;
    for (const n of notes) {
      out.send([0x90 | this.#ch, n & 0x7f, velocity & 0x7f]);
      this.#sounding.add(n);
    }
  }

  noteOff(notes: number[]) {
    const out = this.#out;
    if (!out) return;
    for (const n of notes) {
      out.send([0x80 | this.#ch, n & 0x7f, 0]);
      this.#sounding.delete(n);
    }
  }

  // Coupe tout : notes connues + CC 123 (All Notes Off) sur les 16 canaux.
  panic() {
    const out = this.#out;
    if (!out) return;
    this.noteOff([...this.#sounding]);
    for (let c = 0; c < 16; c++) out.send([0xb0 | c, 123, 0]);
  }
}

export const midi = new Midi();
