<script lang="ts">
  import { onMount } from 'svelte';
  import { midi } from '$lib/midi/midi.svelte';
  import { describe, hex, parseHex } from '$lib/midi/decode';

  let feedback = $state('');
  let ccNum = $state(0);
  let ccVal = $state(127);
  let program = $state(1);
  let raw = $state('');

  onMount(() => {
    if (midi.status === 'idle') midi.connect();
  });

  function send(bytes: number[], label = hex(bytes)) {
    const err = midi.send(bytes);
    feedback = err ? `✗ ${err}` : `✓ envoyé : ${label}`;
  }

  function sendRaw() {
    const bytes = parseHex(raw);
    if (!bytes) {
      feedback = '✗ Hexa invalide (ex. « FA » ou « B0 07 64 » ou « F0 … F7 »).';
      return;
    }
    send(bytes);
  }

  const clampByte = (n: number) => Math.max(0, Math.min(127, Math.round(Number(n) || 0)));

  const t0 = performance.now();
  const fmtTime = (t: number) => ((t - t0) / 1000).toFixed(2) + 's';

  async function copyLog() {
    const text = [...midi.log]
      .reverse()
      .map((e) => `${fmtTime(e.time)}\t${e.dir === 'in' ? '<-' : '->'}\t${hex(e.bytes)}\t${describe(e.bytes)}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      feedback = `✓ ${midi.log.length} messages copiés`;
    } catch {
      feedback = '✗ Copie refusée par le navigateur';
    }
  }
</script>

<div class="page">
  <header>
    <a href="./">← Grille</a>
    <h1>Outils MIDI</h1>
  </header>

  <section>
    <h2>Connexion</h2>
    {#if midi.status !== 'ready'}
      <button class="primary" onclick={() => midi.connect()}>Activer le MIDI</button>
    {/if}
    <p>
      Sortie : <b>{midi.outputs.find((o) => o.id === midi.outputId)?.name ?? 'aucune'}</b> · canal
      <b>{midi.channel}</b>
      <span class="dim">(à changer dans les réglages de la grille)</span>
    </p>
    <p>
      Entrées :
      {#each midi.inputs as i, k (i.id)}<b>{i.name}</b>{k < midi.inputs.length - 1 ? ', ' : ''}{:else}<span
          class="dim">aucune</span>{/each}
    </p>
    <p>
      SysEx :
      {#if midi.sysex}<b class="ok">autorisé</b>
      {:else}<span class="dim">non autorisé</span>
        <button onclick={() => midi.connect(true)}>Autoriser le SysEx</button>
      {/if}
    </p>
  </section>

  <section>
    <h2>Envoyer</h2>
    <div class="line">
      <span class="lbl">Transport</span>
      <button onclick={() => send([0xfa], 'FA Start')}>Start (FA)</button>
      <button onclick={() => send([0xfb], 'FB Continue')}>Continue (FB)</button>
      <button onclick={() => send([0xfc], 'FC Stop')}>Stop (FC)</button>
    </div>
    <div class="line">
      <span class="lbl">CC (canal {midi.channel})</span>
      <input type="number" min="0" max="127" bind:value={ccNum} aria-label="Numéro de CC" />
      <input type="number" min="0" max="127" bind:value={ccVal} aria-label="Valeur" />
      <button onclick={() => send([midi.statusByte(0xb0), clampByte(ccNum), clampByte(ccVal)])}>Envoyer CC</button>
    </div>
    <div class="line">
      <span class="lbl">Program (canal {midi.channel})</span>
      <input type="number" min="1" max="128" bind:value={program} aria-label="Programme" />
      <button onclick={() => send([midi.statusByte(0xc0), clampByte(program - 1)])}>Envoyer PC</button>
    </div>
    <div class="line">
      <span class="lbl">Hexa brut</span>
      <input class="hex" bind:value={raw} placeholder="F0 … F7  ou  B0 07 64" spellcheck="false" autocapitalize="off" />
      <button onclick={sendRaw}>Envoyer</button>
    </div>
    {#if feedback}<p class="feedback" class:bad={feedback.startsWith('✗')}>{feedback}</p>{/if}
  </section>

  <section class="monitor">
    <h2>Moniteur (ce que le clavier envoie)</h2>
    <p class="dim">
      Lance l'écoute, puis appuie sur INTRO, MAIN A/B/C/D, FILL, ENDING, START/STOP… sur le clavier. Si un
      message apparaît, le bouton ↻ le renvoie au clavier pour voir s'il déclenche la même fonction.
    </p>
    <div class="line">
      <button class:primary={!midi.monitoring} onclick={() => (midi.monitoring = !midi.monitoring)}>
        {midi.monitoring ? '⏸ Pause' : '▶ Écouter'}
      </button>
      <button onclick={() => midi.clearLog()}>Effacer</button>
      <button onclick={copyLog} disabled={!midi.log.length}>Copier</button>
      <label><input type="checkbox" bind:checked={midi.hideClock} /> masquer clock/sensing</label>
      <label><input type="checkbox" bind:checked={midi.logOut} /> journaliser l'envoi</label>
    </div>

    <ol class="log">
      {#each midi.log as e (e.id)}
        <li class={e.dir}>
          <span class="t">{fmtTime(e.time)}</span>
          <span class="d">{e.dir === 'in' ? '←' : '→'}</span>
          <code>{hex(e.bytes)}</code>
          <span class="desc">{describe(e.bytes)}</span>
          {#if e.dir === 'in'}
            <button class="replay" title="Renvoyer au clavier" onclick={() => send(e.bytes)}>↻</button>
          {/if}
        </li>
      {:else}
        <li class="dim">{midi.monitoring ? 'En attente de messages…' : 'Écoute arrêtée.'}</li>
      {/each}
    </ol>
  </section>
</div>

<style>
  .page {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 12px 24px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
  }
  header a {
    color: #8fb4ff;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0;
  }
  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.6;
    margin: 0 0 8px;
  }
  section {
    background: #1b1e25;
    border: 1px solid #2c303a;
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  p {
    margin: 4px 0;
    font-size: 0.9rem;
  }
  .dim {
    opacity: 0.6;
  }
  .ok {
    color: #8fd18f;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin-bottom: 8px;
  }
  .lbl {
    min-width: 9em;
    font-size: 0.85rem;
    opacity: 0.8;
  }
  button {
    padding: 7px 12px;
    font-size: 0.95rem;
    border: none;
    border-radius: 8px;
    background: #2b3040;
    color: inherit;
  }
  button.primary {
    background: #3d7cf0;
    color: #fff;
  }
  button:disabled {
    opacity: 0.4;
  }
  input[type='number'],
  input.hex {
    width: 4.5em;
    font-size: 1rem;
    padding: 6px;
    background: #23262e;
    color: inherit;
    border: 1px solid #3a3e48;
    border-radius: 6px;
  }
  input.hex {
    flex: 1;
    min-width: 12em;
    font-family: ui-monospace, monospace;
  }
  label {
    font-size: 0.85rem;
  }
  .feedback {
    color: #8fd18f;
  }
  .feedback.bad {
    color: #ff8a8a;
  }
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 55vh;
    overflow-y: auto;
    font-size: 0.85rem;
  }
  .log li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    border-bottom: 1px solid #262a33;
  }
  .log .t {
    width: 4.5em;
    opacity: 0.5;
    font-variant-numeric: tabular-nums;
  }
  .log li.out .d {
    color: #f0b35d;
  }
  .log li.in .d {
    color: #8fd18f;
  }
  .log code {
    font-family: ui-monospace, monospace;
    word-break: break-all;
  }
  .log .desc {
    flex: 1;
    opacity: 0.8;
  }
  .replay {
    padding: 2px 10px;
  }
</style>
