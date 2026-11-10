<script lang="ts">
  import { useChat } from "$lib/chat/context";
  import { defaultColor } from "$lib/core/colors";
  import {
    deriveProof,
    nickPattern,
    randomProof,
    roomPattern,
    tripOf,
  } from "$lib/core/identity";
  import { t } from "$lib/i18n/locale.svelte";
  import { displayEvent } from "$lib/i18n/translate";
  import TopBar from "$lib/ui/TopBar.svelte";
  import RoomDirectory from "./RoomDirectory.svelte";

  const chat = useChat();
  let channel = $state(new URLSearchParams(location.search).get("ch") || ""),
    nick = $state(""),
    password = $state(""),
    publish = $state(false),
    entering = $state(false),
    preview = $state(""),
    nickField: HTMLInputElement | undefined = $state(),
    goButton: HTMLButtonElement | undefined = $state();
  const target = $derived(channel.trim() || "lobby");
  const room = $derived(chat.directory.find((r) => r.name === target));
  const shown = $derived(nick.trim() || "anon");

  // The trip preview waits for typing to pause; PBKDF2 is deliberately slow.
  let previewSeq = 0;
  $effect(() => {
    const p = password,
      seq = ++previewSeq;
    (async () => {
      if (p) {
        await new Promise((r) => setTimeout(r, 250));
        if (seq !== previewSeq) return;
      }
      const value = p
        ? await tripOf(await deriveProof(p, location.origin))
        : "";
      if (seq === previewSeq) preview = value;
    })();
  });

  function choose(name: string) {
    channel = name;
    (nick ? goButton : nickField)?.focus();
  }

  async function enter(e: SubmitEvent) {
    e.preventDefault();
    chat.entryError = null;
    const n = shown,
      name = target;
    if (!nickPattern.test(n) || !roomPattern.test(name)) {
      chat.entryError = { code: "invalidEntry" };
      return;
    }
    if (chat.status !== "connected") {
      chat.entryError = { code: chat.status };
      return;
    }
    if (entering) return;
    entering = true;
    const proof = password
      ? await deriveProof(password, location.origin)
      : randomProof();
    entering = false;
    if (chat.status !== "connected") {
      chat.entryError = { code: chat.status };
      return;
    }
    password = "";
    chat.enter(n, proof, name, publish);
  }
</script>

<main class="app lobby">
  <TopBar now={chat.now}>
    {#snippet brand()}<span class="brand">PulseC</span>{/snippet}
    {#snippet title()}<span class="ch">#{target}</span> · {room
        ? room.topic || t("noTopic")
        : chat.foundDirectory
          ? t("newRoom")
          : t("noTopic")}{/snippet}
  </TopBar>
  <nav class="tabs" aria-label={t("channel")}>
    <span class="tab act">0:{t("join")}*</span>
  </nav>
  <div class="log gate">
    <h1 class="intro"><span class="mark">PulseC</span> {t("intro")}</h1>
    <p>{t("privacy")}</p>
    {#if chat.status === "unsupported"}<p role="status" class="net-hint">
        {t(chat.status)}
      </p>{/if}
    {#if chat.status === "reconnecting"}<p role="status" class="net-hint">
        {t("offlineHint")}
      </p>{/if}
    <h2>{t("join")}</h2>
    <form onsubmit={enter} autocomplete="off">
      <div class="field">
        <label for="nick">{t("nick")}</label><input
          id="nick"
          bind:this={nickField}
          bind:value={nick}
          maxlength="16"
          placeholder="anon"
        />
      </div>
      <div class="field">
        <label for="pass">{t("password")}</label><input
          id="pass"
          type="password"
          bind:value={password}
          maxlength="256"
          placeholder={t("passwordHint")}
        /><span class="hint">trip {preview || "— · " + t("temporary")}</span>
      </div>
      <div class="field">
        <label for="ch">{t("channel")}</label><input
          id="ch"
          bind:value={channel}
          maxlength="24"
          placeholder="lobby"
        />
      </div>
      <label class="settings"
        ><input type="checkbox" bind:checked={publish} />{t("publish")}</label
      >
      <div class="err" role="status">
        {chat.entryError
          ? displayEvent(t, chat.entryError)
          : t(chat.cacheError)}
      </div>
      <button
        class="go"
        bind:this={goButton}
        disabled={entering || chat.status !== "connected"}
        ><span
          class="dim"
          style:color={preview ? defaultColor(shown, preview) : undefined}
          >{shown}#{preview.slice(0, 5) || "—"}</span
        > <span class="amb">›</span> /join #{target}</button
      >
    </form>
    <h2>{t("about")}</h2>
    <p>{t("identityInfo")}</p>
    <p>{t("limitInfo")}</p>
    <button class="forget" data-action="forget" onclick={() => chat.forget()}
      >{t("forget")}</button
    >
  </div>
  <RoomDirectory {target} onchoose={choose} />
  <div class="bar stat" class:off={chat.status !== "connected"}>
    <span role="status">{t(chat.status)}</span><span
      ><span class="k">{t("onlineLabel")}</span>
      {chat.foundDirectory ? chat.online : "—"}</span
    ><span class="grow"
      ><span class="k">{t("uptimeLabel")}</span>
      {t("minutes", { count: Math.floor(chat.uptime / 60) })}</span
    >
  </div>
  <div class="bar keys">
    <span class="kb"
      ><kbd>⏎</kbd>{t("join")} <kbd>Tab</kbd>{t("nextField")}</span
    >
  </div>
</main>
