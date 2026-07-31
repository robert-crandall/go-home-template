<!--
  The shell's second destination, and the only reason it exists.

  A shell with one destination can't be navigated, so there is nothing for the
  browser suite to click and no non-root route to paste with a trailing slash.
  Delete this file and its entry in `web/src/lib/nav.ts` when you add a page of
  your own - that pair is the whole cost of a destination, in both directions.
-->
<div class="max-w-2xl">
  <h1 class="text-3xl font-bold lg:text-4xl">Second page</h1>
  <p class="py-4">
    There is nothing here. This route exists so the shell has somewhere to go and the browser tests
    have something to click. Delete it, along with its entry in
    <span class="font-mono">web/src/lib/nav.ts</span>, when you add your own.
  </p>
</div>
