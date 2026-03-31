<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData } from 'vitepress'

const { site, page, localeIndex } = useData()

const open = ref(false)
const el = ref<HTMLElement>()

const locales = [
  { key: 'root', label: 'English', link: '/' },
  { key: 'zh', label: '简体中文', link: '/zh/' },
  { key: 'ja', label: '日本語', link: '/ja/' },
]

const currentKey = computed(() => localeIndex.value)

function getLink(locale: typeof locales[number]) {
  const currentPath = page.value.relativePath
  const currentLocale = locales.find(l => l.key === currentKey.value)
  if (!currentLocale) return locale.link

  const relativePath = currentPath.slice(
    currentLocale.link === '/' ? 0 : currentLocale.link.length - 1
  )

  const targetBase = locale.link.replace(/\/$/, '')
  const cleanPath = relativePath
    .replace(/(^|\/)index\.md$/, '$1')
    .replace(/\.md$/, site.value.cleanUrls ? '' : '.html')

  return targetBase + (cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath)
}

function handleBlur(e: FocusEvent) {
  if (el.value && !el.value.contains(e.relatedTarget as Node)) {
    open.value = false
  }
}
</script>

<template>
  <div
    ref="el"
    class="lang-switcher"
    @mouseenter="open = true"
    @mouseleave="open = false"
    @focusout="handleBlur"
  >
    <button
      type="button"
      class="trigger"
      :aria-expanded="open"
      aria-label="Change language"
      @click="open = !open"
    >
      <svg class="lang-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6"/>
      </svg>
    </button>

    <div class="dropdown" :class="{ visible: open }">
      <a
        v-for="locale in locales"
        :key="locale.key"
        :href="getLink(locale)"
        class="option"
        :class="{ active: locale.key === currentKey }"
        @click="open = false"
      >
        <span class="option-label">{{ locale.label }}</span>
        <svg
          v-if="locale.key === currentKey"
          class="check-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5"/>
        </svg>
      </a>
    </div>
  </div>
</template>

<style scoped>
.lang-switcher {
  position: relative;
  display: flex;
  align-items: center;
}
.trigger {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;
}
.trigger:hover {
  color: var(--vp-c-text-1);
  background: rgba(0, 0, 0, 0.05);
}
.dark .trigger:hover {
  background: rgba(255, 255, 255, 0.08);
}
.lang-icon {
  flex-shrink: 0;
}
.chevron {
  flex-shrink: 0;
  opacity: 0.5;
}
.dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 140px;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-3);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-4px);
  transition: opacity 0.2s, visibility 0.2s, transform 0.2s;
  z-index: 100;
}
.dropdown.visible {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.15s, background-color 0.15s;
  white-space: nowrap;
}
.option:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}
.option.active {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.check-icon {
  flex-shrink: 0;
  color: var(--vp-c-brand-1);
}
</style>
