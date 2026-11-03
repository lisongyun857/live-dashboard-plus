<script setup>
import { ref } from 'vue';
import { copyText } from '../lib/ui';

const props = defineProps({
  code: { type: String, default: '' },
});

const label = ref('复制');
const copied = ref(false);

async function onCopy() {
  const ok = await copyText(props.code);
  label.value = ok ? '已复制' : '复制失败';
  copied.value = ok;
  setTimeout(() => {
    label.value = '复制';
    copied.value = false;
  }, 1600);
}
</script>

<template>
  <div class="code-block">
    <button class="copy-btn" :class="{ 'is-copied': copied }" type="button" @click="onCopy">{{ label }}</button>
    <pre><code>{{ code }}</code></pre>
  </div>
</template>
