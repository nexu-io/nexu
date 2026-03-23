<script setup lang="ts">
import { ref, onMounted } from 'vue'

const stars = ref<string | null>(null)

function formatStars(count: number): string {
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  }
  return String(count)
}

onMounted(async () => {
  try {
    const cached = sessionStorage.getItem('nexu-gh-stars')
    if (cached) {
      stars.value = cached
      return
    }
  } catch {}

  try {
    const res = await fetch('https://api.github.com/repos/nexu-io/nexu')
    if (res.ok) {
      const data = await res.json()
      const formatted = formatStars(data.stargazers_count)
      stars.value = formatted
      try { sessionStorage.setItem('nexu-gh-stars', formatted) } catch {}
    }
  } catch {}
})
</script>

<template>
  <a
    class="gh-badge"
    href="https://github.com/nexu-io/nexu"
    target="_blank"
    rel="noopener noreferrer"
    :title="stars ? `${stars} stars on GitHub` : 'GitHub'"
    :aria-label="stars ? `${stars} stars on GitHub` : 'GitHub repository'"
  >
    <svg class="gh-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
    <template v-if="stars">
      <span class="gh-divider" />
      <svg class="gh-star" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/>
      </svg>
      <span class="gh-count">{{ stars }}</span>
    </template>
  </a>
</template>

<style scoped>
.gh-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 16px;
  padding: 4px 10px 4px 8px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.02);
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  transition: all 0.2s ease;
  text-decoration: none;
}
.gh-badge:hover {
  color: var(--vp-c-text-1);
  border-color: rgba(0, 0, 0, 0.15);
  background: rgba(0, 0, 0, 0.04);
}
.dark .gh-badge {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
}
.dark .gh-badge:hover {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
}
.gh-icon {
  flex-shrink: 0;
}
.gh-divider {
  width: 1px;
  height: 12px;
  background: rgba(0, 0, 0, 0.1);
}
.dark .gh-divider {
  background: rgba(255, 255, 255, 0.12);
}
.gh-star {
  flex-shrink: 0;
  color: #e3b341;
}
.gh-count {
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
</style>
