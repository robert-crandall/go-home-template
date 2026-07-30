<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<div class="min-h-screen bg-base-100 text-base-content">
  {@render children()}
</div>
