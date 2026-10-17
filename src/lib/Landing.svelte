<script lang="ts">
  import topo from '../assets/topo.svg';

  let { loading, error, onOpen }: {
    loading: { step: string; seconds: number } | null;
    error: string | null;
    onOpen: () => void;
  } = $props();

  type Os = 'windows' | 'linux';
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  let os: Os = $state(/linux/i.test(platform) ? 'linux' : 'windows');

  /** what to paste into the file picker's address bar; the per-account folder can't be known in advance */
  const START: Record<Os, string> = {
    windows: '%ProgramFiles(x86)%\\Steam\\userdata',
    linux: '~/.local/share/Steam/userdata',
  };
  const REST: Record<Os, string> = {
    windows: '<your id>\\3493540\\local\\save',
    linux: '<your id>/3493540/local/save',
  };

  let copied = $state(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(START[os]);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // clipboard blocked (e.g. non-secure context); the path is still selectable
    }
  }
</script>

<div class="landing" style:--topo="url({topo})">
  <div class="card">
    <header>
      <svg class="roundel" viewBox="0 0 32 20" width="64" height="40" aria-hidden="true">
        <circle cx="16" cy="10" r="7.5" fill="none" stroke="#ffc300" stroke-width="3.5" />
        <rect x="2" y="7.6" width="28" height="4.8" rx="1" fill="currentColor" />
      </svg>
      <div>
        <h1>Fever Calculator</h1>
        <p class="muted">Plan cargo routes in Transport Fever 3</p>
      </div>
    </header>

    <p class="lede">Open a save to see water, towns and industries on a map, then draw routes between them.</p>

    <div class="open" class:busy={loading}>
      {#if loading}
        <p class="step">{loading.step}… <span class="muted">{loading.seconds.toFixed(1)} s</span></p>
        <div class="bar"><div></div></div>
      {:else}
        <button class="primary big" onclick={onOpen}>Open a .sav file</button>
        <span class="muted">or drop it anywhere on this page</span>
      {/if}
    </div>
    {#if error && !loading}
      <p class="error">Couldn't read that save: {error}</p>
    {/if}

    <section>
      <div class="section-head">
        <h2>Where to find your save</h2>
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected={os === 'windows'} class:on={os === 'windows'} onclick={() => (os = 'windows')}>Windows</button>
          <button role="tab" aria-selected={os === 'linux'} class:on={os === 'linux'} onclick={() => (os = 'linux')}>Linux</button>
        </div>
      </div>
      <ol class="stations">
        <li>
          Click <b>Open a .sav file</b>, paste this into the {os === 'windows' ? 'address bar' : 'location bar (press Ctrl+L)'}
          and press Enter:
          <div class="path">
            <code>{START[os]}</code>
            <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </li>
        <li>Open the numbered folder (your Steam account), then <code>{REST[os]}</code>.</li>
        <li>Pick a <code>.sav</code>. The <code>.jpg</code> with the same name is a screenshot of it, which helps
          tell games apart.</li>
      </ol>
      {#if os === 'windows'}
        <p class="muted small">If Steam is installed on another drive, start from the <code>userdata</code> folder inside
          that Steam folder instead. The GOG and Epic versions keep saves in
          <code>%APPDATA%\Transport Fever 3\save</code>.</p>
      {:else}
        <p class="muted small">Steam from Flatpak keeps it under
          <code>~/.var/app/com.valvesoftware.Steam/.local/share/Steam/userdata</code>.</p>
      {/if}
    </section>

    <section>
      <h2>Your save stays on your computer</h2>
      <ul class="privacy">
        <li><b>Nothing is uploaded.</b> The save is read by this page, inside your browser. The site is only static
          files, with no server that could receive it.</li>
        <li><b>Routes are kept in this browser.</b> They're stored per game, so a later save or autosave of the same
          game opens with your routes. Clearing this site's data deletes them; use <b>Export</b> to keep a copy.</li>
        <li><b>No accounts, cookies or analytics.</b></li>
      </ul>
    </section>
  </div>
</div>

<style>
  .landing {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 100vh;
    padding: 56px 16px;
    background: var(--navy);
    isolation: isolate;
  }
  /* contour lines over the navy, like a terrain map behind the sign */
  .landing::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: -1;
    background: var(--on-navy);
    opacity: 0.08;
    mask: var(--topo) center / cover no-repeat;
    -webkit-mask: var(--topo) center / cover no-repeat;
    pointer-events: none;
  }
  .card {
    position: relative;
    overflow: hidden;
    width: 100%;
    max-width: 640px;
    padding: 38px 36px 32px;
    border-radius: 16px;
    background: var(--panel);
    box-shadow: var(--shadow-lg);
  }
  .card::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 6px;
    background: var(--signal);
  }
  @media (max-width: 520px) {
    .landing {
      padding: 16px;
    }
    .card {
      padding: 28px 18px 22px;
    }
  }
  header {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .roundel {
    flex: none;
    color: var(--text);
  }
  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 850;
    letter-spacing: -0.015em;
    line-height: 1;
    text-transform: uppercase;
  }
  header p {
    margin: 6px 0 0;
    font-weight: 500;
  }
  .lede {
    margin: 22px 0 0;
    font-size: 17px;
    line-height: 1.5;
  }
  /* headings as thick line markers, as in the sidebar */
  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.09em;
  }
  h2::before {
    content: '';
    flex: none;
    width: 20px;
    height: 5px;
    border-radius: 3px;
    background: var(--signal);
  }
  .open {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    align-items: center;
    justify-content: center;
    margin: 24px 0 4px;
    padding: 28px 16px;
    border: 2px dashed var(--border);
    border-radius: 12px;
    background: var(--sunken);
    text-align: center;
  }
  .open.busy {
    justify-content: flex-start;
    text-align: left;
  }
  .open .step,
  .open .bar {
    flex-basis: 100%;
    margin: 0;
  }
  .open .step {
    font-weight: 600;
  }
  .big {
    padding: 13px 26px 11px;
    font-size: 17px;
    box-shadow: 0 2px 0 #c99700;
  }
  section {
    margin-top: 28px;
  }
  .section-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }
  .tabs {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--sunken);
  }
  .tabs button {
    padding: 4px 13px 3px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 13px;
  }
  .tabs button:hover:not(.on) {
    background: none;
    color: var(--text);
  }
  .tabs button.on {
    background: var(--navy);
    color: var(--on-navy);
  }
  ol,
  ul {
    margin: 14px 0 0;
    padding-left: 20px;
    line-height: 1.55;
  }
  li + li {
    margin-top: 10px;
  }
  li::marker {
    color: var(--muted);
  }

  /* the steps as numbered stations on a line */
  .stations {
    position: relative;
    padding-left: 40px;
    list-style: none;
    counter-reset: stop;
  }
  .stations::before {
    content: '';
    position: absolute;
    top: 10px;
    bottom: 12px;
    left: 11px;
    width: 4px;
    border-radius: 2px;
    background: var(--signal);
  }
  .stations li {
    position: relative;
    counter-increment: stop;
  }
  .stations li + li {
    margin-top: 14px;
  }
  .stations li::before {
    content: counter(stop);
    position: absolute;
    top: -1px;
    left: -40px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 3px solid var(--signal);
    border-radius: 50%;
    background: var(--panel);
    color: var(--text);
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
    padding-top: 2px;
  }

  li code {
    padding: 1px 5px 0;
    border-radius: 4px;
    background: var(--sunken);
  }
  .path {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
    padding: 6px 6px 6px 14px;
    border: 1.5px solid var(--navy-line);
    border-radius: 10px;
    background: var(--navy);
  }
  .path code {
    flex: 1;
    padding: 0;
    background: none;
    color: var(--signal);
    font-size: 13px;
  }
  .path button {
    flex-shrink: 0;
    min-width: 70px;
    border-color: var(--navy-line);
    background: var(--navy-2);
    color: var(--on-navy);
    font-size: 13px;
  }
  .path button:hover:not(:disabled) {
    background: var(--navy-3);
  }
  .privacy {
    padding-left: 0;
    list-style: none;
  }
  .privacy li {
    position: relative;
    padding: 12px 14px 10px 14px;
    border-left: 4px solid var(--signal);
    border-radius: 0 8px 8px 0;
    background: var(--sunken);
  }
  .privacy li + li {
    margin-top: 8px;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    margin: 14px 0 0;
    font-size: 13px;
    line-height: 1.5;
  }
  .small code {
    padding: 1px 5px 0;
    border-radius: 4px;
    background: var(--sunken);
  }
  .error {
    margin: 12px 0 0;
    padding: 10px 14px 8px;
    border-left: 4px solid var(--error);
    border-radius: 0 8px 8px 0;
    background: color-mix(in srgb, var(--error) 12%, transparent);
    color: var(--error);
    font-weight: 600;
  }
  .bar {
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--border);
  }
  .bar div {
    width: 30%;
    height: 100%;
    border-radius: 3px;
    background: var(--signal);
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(340%); }
  }
</style>
