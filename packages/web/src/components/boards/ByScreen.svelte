<script lang="ts">
  /**
   * Wording that depends on the screen. On a phone the Todos page isn't
   * called that anywhere: the tab bar offers Today and Plan, two views of
   * it. Copy that points people at "the Todos page" has to name what they
   * can actually see, so it carries both wordings and CSS shows one.
   */
  let { wide, phone }: { wide: string; phone: string } = $props();
</script>

<span class="wide">{wide}</span><span class="phone">{phone}</span>

<style>
  .phone {
    display: none;
  }

  /* Same breakpoint as the phone tab bar (MobileTabBar.svelte): wider than
     this, the header still says "Todos". */
  @media (max-width: 600px) {
    .wide {
      display: none;
    }

    .phone {
      display: inline;
    }
  }
</style>
