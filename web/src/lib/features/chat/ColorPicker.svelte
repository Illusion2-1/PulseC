<script lang="ts">
  import { normalizeHex } from "#lib/core/colors.ts";
  import { t } from "#lib/i18n/locale.svelte.ts";

  let {
    value,
    preview,
    nick,
    onpick,
    ondone,
    onapply,
  }: {
    value: string;
    preview: string;
    nick: string;
    onpick: (value: string) => void;
    ondone: () => void;
    onapply: () => void;
  } = $props();
  const selected = $derived(normalizeHex(value));
  const palette = [
    "#ffb000",
    "#e7998c",
    "#e6ad70",
    "#9ece6a",
    "#8fc3da",
    "#c9a4df",
    "#c792ea",
    "#c9c6bb",
  ];
</script>

<div class="color-picker" role="group" aria-label={t("colorPicker")}>
  <div class="color-swatches">
    {#each palette as hex}<button
        type="button"
        class="color-swatch"
        class:chosen={selected === hex}
        style:background-color={hex}
        aria-label={hex}
        aria-pressed={selected === hex}
        title={hex}
        onclick={() => {
          onpick(hex);
          ondone();
        }}
      ></button>{/each}
  </div>
  <div class="color-fields">
    <label class="color-custom"
      ><input
        type="color"
        aria-label={t("customColor")}
        value={selected ?? "#ffb000"}
        oninput={(e) => onpick(e.currentTarget.value)}
        onchange={ondone}
      />{t("customColor")}</label
    >
    <label class="color-hex"
      >HEX <input
        type="text"
        aria-label="HEX"
        {value}
        placeholder="#rrggbb"
        spellcheck="false"
        autocomplete="off"
        maxlength="7"
        aria-invalid={!!value && !selected}
        oninput={(e) => onpick(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === "Enter" && !e.isComposing && (!value || selected)) {
            e.preventDefault();
            onapply();
          }
        }}
      /></label
    >
    <button
      type="button"
      class="color-reset"
      onclick={() => {
        onpick("");
        ondone();
      }}>{t("resetColor")}</button
    >
  </div>
  <div class="color-preview" style:color={preview}>
    {t("colorPreview", { name: nick })}
  </div>
  <p class="pop-help">{t("colorPickerHint")}</p>
</div>
