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

export interface LogEntry {
  id: number;
  time: number; // ms (performance.now)
  dir: 'in' | 'out';
  port: string;
  bytes: number[];
}

const LOG_MAX = 300;

class Midi {
  supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  status = $state<'idle' | 'ready' | 'denied' | 'unsupported'>('idle');
  error = $state('');
  sysex = $state(false); // accès SysEx accordé
  outputs = $state<{ id: string; name: string }[]>([]);
  inputs = $state<{ id: string; name: string }[]>([]);
  outputId = $state('');
  channel = $state(1); // 1..16 (affichage humain)

  // Moniteur
  monitoring = $state(false);
  logOut = $state(false); // journaliser aussi ce qu'on envoie
  hideClock = $state(true); // masquer F8 (clock) et FE (active sensing)
  log = $state<LogEntry[]>([]);
  #logId = 0;

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

  // sysex=true demande une permission supplémentaire (nécessaire pour voir et
  // envoyer des messages F0 … F7).
  async connect(sysex = false) {
    if (!this.supported) return;
    try {
      if (this.#access) this.#access.onstatechange = null;
      this.#access = await navigator.requestMIDIAccess({ sysex });
      this.sysex = sysex;
      this.status = 'ready';
      this.error = '';
      this.#refresh();
      this.#access.onstatechange = () => this.#refresh();
    } catch (e) {
      if (!sysex) this.status = 'denied';
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  #refresh() {
    if (!this.#access) return;
    this.outputs = [...this.#access.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id }));
    const ins = [...this.#access.inputs.values()];
    this.inputs = ins.map((i) => ({ id: i.id, name: i.name ?? i.id }));
    for (const input of ins) {
      const name = input.name ?? input.id;
      input.onmidimessage = (ev) => {
        if (!this.monitoring || !ev.data) return;
        this.#push('in', name, [...ev.data]);
      };
    }
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

  #push(dir: 'in' | 'out', port: string, bytes: number[]) {
    if (this.hideClock && (bytes[0] === 0xf8 || bytes[0] === 0xfe)) return;
    const e: LogEntry = { id: ++this.#logId, time: performance.now(), dir, port, bytes };
    this.log = [e, ...this.log].slice(0, LOG_MAX);
  }

  clearLog() {
    this.log = [];
  }

  // Envoi brut. Renvoie un message d'erreur, ou '' si OK.
  send(bytes: number[]): string {
    const out = this.#out;
    if (!out) return 'Aucune sortie MIDI sélectionnée.';
    if (bytes[0] === 0xf0 && !this.sysex) return 'SysEx non autorisé : activer le SysEx d’abord.';
    try {
      out.send(bytes);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    if (this.monitoring && this.logOut) this.#push('out', out.name ?? out.id, bytes);
    return '';
  }

  /** Octet de statut d'un message canal sur le canal courant. */
  statusByte(kind: number) {
    return (kind & 0xf0) | this.#ch;
  }

  noteOn(notes: number[], velocity = 100) {
    for (const n of notes) {
      if (this.send([0x90 | this.#ch, n & 0x7f, velocity & 0x7f])) return;
      this.#sounding.add(n);
    }
  }

  noteOff(notes: number[]) {
    for (const n of notes) {
      this.send([0x80 | this.#ch, n & 0x7f, 0]);
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
