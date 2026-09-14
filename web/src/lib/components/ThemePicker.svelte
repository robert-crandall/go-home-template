<script lang="ts">
  let preference = $state(window.appTheme.get());

  function change(value: string) {
    window.appTheme.set(value);
    preference = value;
  }
</script>

<label class="flex flex-wrap items-center gap-inline">
  <span>Theme</span>
  <select class="select" value={preference} onchange={(event) => change(event.currentTarget.value)}>
    {#each window.appTheme.choices as choice}
      <option value={choice.value}>{choice.label}</option>
    {/each}
  </select>
</label>
