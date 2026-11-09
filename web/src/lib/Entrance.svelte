<script>
  import { t, clock } from "./locale.js";
  import { displayEvent } from "./messages.js";
  import { spark } from "./format.js";
  import { nicks, names } from "./session.js";
  import LanguagePicker from "./LanguagePicker.svelte";
  export let channel = "",
    now,
    foundDirectory,
    status,
    directory,
    total,
    uptime,
    known,
    cacheError,
    forget,
    onEnter;
  export let error = null;
  let nick = "",
    password = "",
    publish = false;
  const hex = (b) =>
    Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join(
      "",
    );
  const hash = async (s) =>
    hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  async function credential(password) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    return hex(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: enc.encode("PulseC trip v1/" + location.origin),
          iterations: 310000,
        },
        key,
        256,
      ),
    );
  }
  let preview = "",
    previewSeq = 0,
    entering = false;
  async function previewTrip(p) {
    let seq = ++previewSeq;
    if (p) {
      await new Promise((r) => setTimeout(r, 250));
      if (seq !== previewSeq) return;
    }
    const val = p
      ? (await hash("PulseC trip v1/" + (await credential(p)))).slice(0, 16)
      : "";
    if (seq === previewSeq) preview = val;
  }
  $: previewTrip(password);
  async function enter() {
    error = null;
    const n = nick.trim() || "anon",
      name = channel.trim() || "lobby";
    if (!nicks.test(n) || !names.test(name)) {
      error = { code: "invalidEntry" };
      return;
    }
    if (status !== "connected") {
      error = { code: status };
      return;
    }
    if (entering) return;
    entering = true;
    const proof = password
      ? await credential(password)
      : hex(crypto.getRandomValues(new Uint8Array(32)));
    entering = false;
    if (status !== "connected") {
      error = { code: status };
      return;
    }
    password = "";
    onEnter(n, proof, name, publish);
  }
</script>

<header class="bar head">
  <span class="amb">PulseC</span><span class="grow">WebTransport / HTTP·3</span
  ><LanguagePicker /><span role="status">{$t(status)}</span><time
    >{$clock(now)}</time
  >
</header>
<main class="gate">
  <h1 class="intro"><span class="mark">PulseC</span> {$t("intro")}</h1>
  <p>
    {$t("privacy")}
  </p>
  <p class="dim">
    {$t("stats", {
      minutes: Math.floor(uptime / 60),
      online: foundDirectory ? total : "—",
    })}
  </p>
  {#if status === "unsupported"}<p role="status" class="net-hint">
      {$t(status)}
    </p>{/if}
  {#if status === "reconnecting"}<p role="status" class="net-hint">
      {$t("offlineHint")}
    </p>{/if}
  <h2>{$t("join")}</h2>
  <form on:submit|preventDefault={enter} autocomplete="off">
    <div class="field">
      <label for="nick">{$t("nick")}</label><input
        id="nick"
        bind:value={nick}
        maxlength="16"
        placeholder="anon"
      />
    </div>
    <div class="field">
      <label for="pass">{$t("password")}</label><input
        id="pass"
        type="password"
        bind:value={password}
        maxlength="256"
        placeholder={$t("passwordHint")}
      /><span class="hint">trip {preview || "— · " + $t("temporary")}</span>
    </div>
    <div class="field">
      <label for="ch">{$t("channel")}</label><input
        id="ch"
        bind:value={channel}
        maxlength="24"
        placeholder="lobby"
      />
    </div>
    <label class="settings"
      ><input type="checkbox" bind:checked={publish} />{$t("publish")}</label
    >
    <div class="err" role="status">
      {error ? displayEvent($t, error) : $t(cacheError)}
    </div>
    <button class="go" disabled={entering || status !== "connected"}
      >» {$t("join")} #{channel.trim() || "lobby"} <kbd>⏎</kbd></button
    >
  </form>
  <h2>{$t("publicRooms")}</h2>
  <table class="chan">
    <colgroup
      ><col class="c-n" /><col class="c-u" /><col class="c-p hide-s" /><col
      /></colgroup
    ><thead
      ><tr
        ><th>{$t("channel")}</th><th>{$t("online")}</th><th class="hide-s"
          >{$t("pulse")}</th
        ><th>{$t("topic")}</th></tr
      ></thead
    ><tbody>
      {#each directory.filter((r) => r.public) as r}<tr
          class:sel={r.name === channel}
          ><td><button on:click={() => (channel = r.name)}>{r.name}</button></td
          ><td>{r.online}</td><td class="pulse hide-s">{spark(r.pulse)}</td><td
            class="topic">{r.topic || "—"}</td
          ></tr
        >{:else}<tr
          ><td colspan="4" class="mid"
            >{foundDirectory ? $t("noPublic") : $t(status)}</td
          ></tr
        >{/each}</tbody
    >
  </table>
  <h2>{$t("knownRooms")}</h2>
  {#if known.length}<table class="chan">
      <colgroup
        ><col class="c-n" /><col class="c-u" /><col class="c-p hide-s" /><col
        /></colgroup
      ><thead
        ><tr
          ><th>{$t("channel")}</th><th>{$t("online")}</th><th class="hide-s"
            >{$t("pulse")}</th
          ><th>{$t("topic")}</th></tr
        ></thead
      ><tbody>
        {#each known as n}{@const r = directory.find((r) => r.name === n)}<tr
            class:sel={n === channel}
            ><td><button on:click={() => (channel = n)}>{n}</button></td><td
              >{foundDirectory ? r?.online || 0 : "—"}</td
            ><td class="pulse hide-s">{r ? spark(r.pulse) : "—"}</td><td
              class="topic">{r?.topic || "—"}</td
            ></tr
          >{/each}</tbody
      >
    </table>{:else}<p>{$t("noKnown")}</p>{/if}
  <button class="forget" data-action="forget" on:click={forget}
    >{$t("forget")}</button
  >
  <h2>{$t("about")}</h2>
  <p>
    {$t("identityInfo")}
  </p>
  <p>
    {$t("limitInfo")}
  </p>
</main>
