---
layout: false
title: Redirecting...
---

<script setup>
import { onMounted } from "vue";

onMounted(() => {
  const prefersZh = navigator.languages.some((language) =>
    language.toLowerCase().startsWith("zh"),
  );

  window.location.replace(prefersZh ? "./zh/" : "./en/");
});
</script>

<noscript>
  <meta http-equiv="refresh" content="0; url=./en/" />
</noscript>

Redirecting to the documentation...

If you are not redirected, open [English](./en/) or [简体中文](./zh/).
