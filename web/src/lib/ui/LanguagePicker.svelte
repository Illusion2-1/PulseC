<script lang="ts">
  import { locale } from "#lib/i18n/locale.svelte.ts";
  import type { Locale } from "#lib/i18n/translate.ts";
</script>

<select
  class="language"
  aria-label="Language / 语言"
  value={locale.language}
  onchange={(e) => locale.set(e.currentTarget.value as Locale)}
>
  <option value="zh-CN">简体中文</option>
  <option value="en">English</option>
</select>
