<script>
  import { language, setLanguage } from "./locale.js";
</script>

<select
  class="language"
  aria-label="Language / 语言"
  value={$language}
  on:change={(e) => setLanguage(e.currentTarget.value)}
>
  <option value="zh-CN">简体中文</option>
  <option value="en">English</option>
</select>
