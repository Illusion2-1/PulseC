<script>
  import { t, clock } from "./locale.js";
  import { displayEvent } from "./messages.js";
  import { spark } from "./format.js";
  import { defaultColor } from "./colors.js";
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
    publish = false,
    nickField,
    goButton;
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
  $: target = channel.trim() || "lobby";
  $: room = directory.find((r) => r.name === target);
  $: listed = directory.filter((r) => r.public);
  function choose(name) {
    channel = name;
    (nick ? goButton : nickField)?.focus();
  }
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

{#snippet row(name, r)}
  <button
    class="c"
    class:sel={name === target}
    aria-current={name === target ? "true" : undefined}
    title={r?.topic ? "#" + name + " · " + r.topic : "#" + name}
    on:click={() => choose(name)}
    ><span class="cn"
      >#{name}{#if r?.locked}<span class="lk">
          · {$t("lockedRoom")}</span
        >{/if}</span
    ><span class="pulse">{r ? spark(r.pulse.slice(-10)) : ""}</span><span
      class="co">{foundDirectory ? r?.online || 0 : "—"}</span
    >{#if r?.topic}<span class="ct">{r.topic}</span>{/if}</button
  >
{/snippet}

<main class="app lobby">
  <header class="bar head">
    <span class="brand">PulseC</span><span class="grow"
      ><span class="ch">#{target}</span> · {room
        ? room.topic || $t("noTopic")
        : foundDirectory
          ? $t("newRoom")
          : $t("noTopic")}</span
    ><span class="wide">WebTransport · TLS 1.3</span><LanguagePicker /><time
      >{$clock(now)}</time
    >
  </header>
  <nav class="tabs" aria-label={$t("channel")}>
    <span class="tab act">0:{$t("join")}*</span>
  </nav>
  <div class="log gate">
    <h1 class="intro"><span class="mark">PulseC</span> {$t("intro")}</h1>
    <p>{$t("privacy")}</p>
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
          bind:this={nickField}
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
      <button
        class="go"
        bind:this={goButton}
        disabled={entering || status !== "connected"}
        ><span
          class="dim"
          style:color={preview
            ? defaultColor(nick.trim() || "anon", preview)
            : undefined}
          >{nick.trim() || "anon"}#{preview.slice(0, 5) || "—"}</span
        > <span class="amb">›</span> /join #{target}</button
      >
    </form>
    <h2>{$t("about")}</h2>
    <p>{$t("identityInfo")}</p>
    <p>{$t("limitInfo")}</p>
    <button class="forget" data-action="forget" on:click={forget}
      >{$t("forget")}</button
    >
  </div>
  <aside class="users" aria-label={$t("channel")}>
    <h3>{$t("publicRooms")} <span>{listed.length}</span></h3>
    {#each listed as r (r.name)}{@render row(r.name, r)}{:else}<p class="empty">
        {foundDirectory ? $t("noPublic") : $t(status)}
      </p>{/each}
    <h3>{$t("knownRooms")} <span>{known.length}</span></h3>
    {#each known as n (n)}{@render row(
        n,
        directory.find((r) => r.name === n),
      )}{:else}<p class="empty">{$t("noKnown")}</p>{/each}
  </aside>
  <div class="bar stat" class:off={status !== "connected"}>
    <span role="status">{$t(status)}</span><span
      ><span class="k">{$t("onlineLabel")}</span>
      {foundDirectory ? total : "—"}</span
    ><span class="grow"
      ><span class="k">{$t("uptimeLabel")}</span>
      {$t("minutes", { count: Math.floor(uptime / 60) })}</span
    >
  </div>
  <div class="bar keys">
    <span class="kb"
      ><kbd>⏎</kbd>{$t("join")} <kbd>Tab</kbd>{$t("nextField")}</span
    >
  </div>
</main>
