<script lang="ts">
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

<div class="landing">
  <div class="card">
    <header>
      <svg viewBox="0 0 16 16" width="36" height="36" aria-hidden="true">
        <path d="M4 12 12 4" stroke="#d6336c" stroke-width="2" />
        <circle cx="4" cy="12" r="3" fill="#9632c8" />
        <circle cx="12" cy="4" r="3" fill="#28aa3c" />
      </svg>
      <div>
        <h1>Fever Calculator</h1>
        <p class="muted">Plan cargo routes in Transport Fever 3</p>
      </div>
    </header>

    <p>Open a save to see water, towns and industries on a map, then draw routes between them.</p>

    <div class="open">
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
      <ol>
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
    display: grid;
    place-items: center;
    min-height: 100vh;
    padding: 16px;
  }
  .card {
    width: 100%;
    max-width: 600px;
    padding: 28px;
    border-radius: 10px;
    background: var(--panel);
    border: 1px solid var(--border);
  }
  header {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  header p {
    margin: 2px 0 0;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .open {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: center;
    margin: 20px 0;
  }
  .open .step,
  .open .bar {
    flex-basis: 100%;
    margin: 0;
  }
  .big {
    padding: 10px 18px;
    font-size: 16px;
  }
  section {
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
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
    padding: 2px;
    border-radius: 6px;
    background: var(--hover);
  }
  .tabs button {
    padding: 3px 10px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 13px;
  }
  .tabs button.on {
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }
  ol,
  ul {
    margin: 12px 0 0;
    padding-left: 20px;
    line-height: 1.5;
  }
  li + li {
    margin-top: 8px;
  }
  .path {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
    padding: 6px 6px 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
  }
  .path code {
    flex: 1;
    font-size: 13px;
  }
  .path button {
    flex-shrink: 0;
    font-size: 13px;
  }
  .privacy {
    color: var(--text);
  }
  .muted {
    color: var(--muted);
  }
  .small {
    margin: 10px 0 0;
    font-size: 13px;
  }
  .error {
    color: var(--error);
  }
  .bar {
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--hover);
  }
  .bar div {
    width: 30%;
    height: 100%;
    background: var(--accent);
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(340%); }
  }
</style>
