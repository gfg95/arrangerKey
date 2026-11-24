<script lang="ts">
  import { onMount } from 'svelte';
  import { midi } from '$lib/midi/midi.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { parseGrid, compactVoicing, padLabel, type GridPad } from '$lib/music/grid';
  import { keepScreenOn } from '$lib/browser/wakeLock';

  let panel = $state<'none' | 'settings' | 'edit'>('none');
  let activeId = $state<string | null>(null);
  let sounding: number[] = [];

  const grid = $derived(parseGrid(settings.gridText));

  const NOTE_FR = ['do', 'do#', 'ré', 'mib', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'sib', 'si'];
  const BASES = Array.from({ length: 25 }, (_, i) => 36 + i); // do2 … do4
  const noteName = (m: number) => `${NOTE_FR[m % 12]}${Math.floor(m / 12) - 1}`;

  onMount(() => {
    if (midi.status === 'idle') midi.connect();
    return keepScreenOn();
  });

  function silence() {
    if (sounding.length) midi.noteOff(sounding);
    sounding = [];
    activeId = null;
  }

  function press(id: string, pad: GridPad) {
    if (!pad.cell) return;
    const wasActive = activeId === id;
    silence();
    if (settings.latch && wasActive) return; // re-toucher le pad actif = relâcher
    sounding = compactVoicing(pad.cell, settings.transpose, settings.base);
    midi.noteOn(sounding);
    activeId = id;
  }

  function release(id: string) {
    if (!settings.latch && activeId === id) silence();
  }

  function stop() {
    silence();
    midi.panic();
  }

  function transpose(d: number) {
    // Un changement de tonalité pendant qu'un accord tient : on le rejoue transposé.
    settings.transpose = Math.max(-11, Math.min(11, settings.transpose + d));
    if (activeId) {
      const [r, i] = activeId.split('-').map(Number);
      const pad = grid.rows[r]?.pads[i];
      const id = activeId;
      silence();
      if (pad) {
        activeId = null;
        press(id, pad);
      }
    }
  }

  // Les réglages qui changent le son coupent l'accord tenu.
  function resetSound() {
    stop();
  }
</script>

<div class="app" style:--pad={settings.padSize + 'px'}>
  <header>
    <div class="group">
      <button onclick={() => transpose(-1)} aria-label="Transposer -1">−</button>
      <span class="tr" title="Transposition">{settings.transpose > 0 ? '+' : ''}{settings.transpose}</span>
      <button onclick={() => transpose(1)} aria-label="Transposer +1">+</button>
    </div>

    <span class="status" class:ok={midi.status === 'ready' && midi.outputId}>
      {#if midi.status === 'unsupported'}Web MIDI indisponible
      {:else if midi.status !== 'ready'}MIDI non connecté
      {:else if !midi.outputId}Aucune sortie
      {:else}{midi.outputs.find((o) => o.id === midi.outputId)?.name} · can. {midi.channel}{/if}
    </span>

    <div class="group">
      <button class:on={panel === 'edit'} onclick={() => (panel = panel === 'edit' ? 'none' : 'edit')}>✎</button>
      <button class:on={panel === 'settings'} onclick={() => (panel = panel === 'settings' ? 'none' : 'settings')}>⚙</button>
      <button class="stop" onclick={stop}>■</button>
    </div>
  </header>

  {#if panel === 'settings'}
    <section class="panel settings">
      {#if midi.status !== 'ready'}
        <button onclick={() => midi.connect()}>Activer le MIDI</button>
        {#if midi.error}<p class="err">Accès refusé : {midi.error}</p>{/if}
      {/if}
      <label>
        Sortie
        <select bind:value={midi.outputId} onchange={() => { resetSound(); midi.save(); }}>
          {#each midi.outputs as o (o.id)}
            <option value={o.id}>{o.name}</option>
          {:else}
            <option value="">Aucune sortie MIDI</option>
          {/each}
        </select>
      </label>
      <label>
        Canal
        <select bind:value={midi.channel} onchange={() => { resetSound(); midi.save(); }}>
          {#each Array.from({ length: 16 }, (_, i) => i + 1) as c (c)}
            <option value={c}>{c}</option>
          {/each}
        </select>
      </label>
      <label>
        Note la plus grave
        <select bind:value={settings.base} onchange={resetSound}>
          {#each BASES as b (b)}
            <option value={b}>{noteName(b)}</option>
          {/each}
        </select>
      </label>
      <label>
        Taille des pads
        <input type="range" min="40" max="140" step="4" bind:value={settings.padSize} />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={settings.latch} onchange={resetSound} />
        Tenir l'accord
      </label>
      <a class="tools" href="./outils">Outils MIDI (moniteur, tests) →</a>
    </section>
  {/if}

  {#if panel === 'edit'}
    <section class="panel edit">
      <textarea bind:value={settings.gridText} rows="8" spellcheck="false" autocapitalize="off"></textarea>
      <p class="help">
        Une ligne = une rangée · séparateurs : espace , ; | · <code>%</code> répète ·
        <code>-</code> case vide · <code>:Refrain</code> titre de section
      </p>
      {#each grid.errors as e}<p class="err">{e}</p>{/each}
    </section>
  {/if}

  <main class="grid">
    {#each grid.rows as row, r (r)}
      {#if row.title}<h2>{row.title}</h2>{/if}
      <div class="row">
        {#each row.pads as pad, i (i)}
          {@const id = `${r}-${i}`}
          {#if pad.cell}
            <button
              class="pad"
              class:on={activeId === id}
              onpointerdown={(e) => { e.preventDefault(); press(id, pad); }}
              onpointerup={() => release(id)}
              onpointerleave={() => release(id)}
              onpointercancel={() => release(id)}
              oncontextmenu={(e) => e.preventDefault()}
            >{padLabel(pad.cell, settings.transpose)}</button>
          {:else}
            <span class="pad empty"></span>
          {/if}
        {/each}
      </div>
    {/each}
  </main>
</div>

<style>
  .app {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: #1d2027;
    border-bottom: 1px solid #2c303a;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  header button {
    min-width: 40px;
    height: 40px;
    font-size: 1.2rem;
    border: none;
    border-radius: 8px;
    background: #2b3040;
    color: inherit;
  }
  header button.on {
    background: #3d7cf0;
  }
  header button.stop {
    background: #7a2e2e;
  }
  .tr {
    min-width: 2.2em;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .status {
    flex: 1;
    min-width: 0;
    text-align: center;
    font-size: 0.8rem;
    color: #ff8a8a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status.ok {
    color: #8fd18f;
  }
  .panel {
    padding: 10px 12px;
    background: #1b1e25;
    border-bottom: 1px solid #2c303a;
  }
  .settings {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
  }
  .settings button {
    padding: 8px 14px;
    border: none;
    border-radius: 8px;
    background: #3d7cf0;
    color: #fff;
    font-size: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.8rem;
  }
  .tools {
    align-self: flex-end;
    color: #8fb4ff;
    font-size: 0.9rem;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    align-self: flex-end;
  }
  select {
    font-size: 1rem;
    padding: 5px;
    background: #23262e;
    color: inherit;
    border: 1px solid #3a3e48;
    border-radius: 6px;
  }
  textarea {
    box-sizing: border-box;
    width: 100%;
    font: 1rem/1.4 ui-monospace, monospace;
    background: #23262e;
    color: inherit;
    border: 1px solid #3a3e48;
    border-radius: 6px;
    padding: 8px;
  }
  .help {
    margin: 6px 0 0;
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .err {
    margin: 4px 0 0;
    color: #ff8a8a;
    font-size: 0.85rem;
  }
  .grid {
    padding: 8px;
  }
  h2 {
    margin: 10px 2px 4px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.6;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }
  .pad {
    flex: 1 0 var(--pad);
    max-width: calc(var(--pad) * 2.2);
    height: var(--pad);
    padding: 0 4px;
    font-size: calc(var(--pad) * 0.3);
    font-weight: 600;
    border: none;
    border-radius: 8px;
    background: #2b3040;
    color: inherit;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    white-space: nowrap;
    overflow: hidden;
  }
  .pad.on {
    background: #3d7cf0;
    color: #fff;
  }
  .pad.empty {
    background: transparent;
  }
</style>
