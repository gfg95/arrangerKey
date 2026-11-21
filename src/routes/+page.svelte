<script lang="ts">
  import { midi } from '$lib/midi/midi.svelte';

  // Étape 0 : quelques accords codés en dur, en position serrée autour de Do3 (48).
  const TEST_CHORDS: { name: string; notes: number[] }[] = [
    { name: 'C', notes: [48, 52, 55] },
    { name: 'G', notes: [43, 47, 50] },
    { name: 'Am', notes: [45, 48, 52] },
    { name: 'F', notes: [41, 45, 48] }
  ];

  let latch = $state(true); // true : l'accord tient jusqu'au suivant
  let current = $state<number[] | null>(null);
  let active = $state<string | null>(null);

  function press(c: { name: string; notes: number[] }) {
    if (current) midi.noteOff(current);
    if (latch && active === c.name) {
      // Re-toucher le même pad en mode verrouillé : on relâche.
      current = null;
      active = null;
      return;
    }
    midi.noteOn(c.notes);
    current = c.notes;
    active = c.name;
  }

  function release() {
    if (latch || !current) return;
    midi.noteOff(current);
    current = null;
    active = null;
  }

  function stop() {
    midi.panic();
    current = null;
    active = null;
  }
</script>

<main>
  <h1>ArrangerKey <small>test MIDI</small></h1>

  {#if midi.status === 'unsupported'}
    <p class="err">Web MIDI n'est pas disponible dans ce navigateur (essayer Chrome Android).</p>
  {:else if midi.status !== 'ready'}
    <button class="big" onclick={() => midi.connect()}>Activer le MIDI</button>
    {#if midi.error}<p class="err">Accès refusé : {midi.error}</p>{/if}
  {:else}
    <section class="settings">
      <label>
        Sortie
        <select bind:value={midi.outputId} onchange={() => midi.save()}>
          {#each midi.outputs as o (o.id)}
            <option value={o.id}>{o.name}</option>
          {:else}
            <option value="">Aucune sortie MIDI détectée</option>
          {/each}
        </select>
      </label>
      <label>
        Canal
        <select
          bind:value={midi.channel}
          onchange={() => {
            stop();
            midi.save();
          }}
        >
          {#each Array.from({ length: 16 }, (_, i) => i + 1) as c (c)}
            <option value={c}>{c}</option>
          {/each}
        </select>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={latch} onchange={stop} />
        Tenir l'accord
      </label>
    </section>

    <section class="pads">
      {#each TEST_CHORDS as c (c.name)}
        <button
          class="pad"
          class:on={active === c.name}
          onpointerdown={(e) => {
            e.preventDefault();
            press(c);
          }}
          onpointerup={release}
          onpointerleave={release}
          onpointercancel={release}
        >
          {c.name}
        </button>
      {/each}
    </section>

    <button class="stop" onclick={stop}>Stop (toutes notes off)</button>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #16181d;
    color: #e8e8ea;
    font-family: system-ui, sans-serif;
  }
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 16px;
  }
  h1 small {
    font-size: 0.5em;
    opacity: 0.6;
  }
  .settings {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 20px;
    margin-bottom: 20px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
    opacity: 0.9;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    align-self: flex-end;
  }
  select {
    font-size: 1rem;
    padding: 6px;
    background: #23262e;
    color: inherit;
    border: 1px solid #3a3e48;
    border-radius: 6px;
  }
  .pads {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
  }
  .pad {
    aspect-ratio: 1;
    font-size: 2rem;
    font-weight: 600;
    border: none;
    border-radius: 14px;
    background: #2b3040;
    color: inherit;
    touch-action: none;
    user-select: none;
  }
  .pad.on {
    background: #3d7cf0;
  }
  .big,
  .stop {
    margin-top: 20px;
    padding: 14px 20px;
    font-size: 1.1rem;
    border-radius: 10px;
    border: none;
    background: #3a3e48;
    color: inherit;
  }
  .stop {
    background: #7a2e2e;
  }
  .err {
    color: #ff8a8a;
  }
</style>
