<script lang="ts">
  let { children } = $props();
</script>

{@render children()}

<style>
  :global(body) {
    margin: 0;
    background: #16181d;
    color: #e8e8ea;
    font-family: system-ui, sans-serif;
  }
</style>
