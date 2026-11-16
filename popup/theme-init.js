try {
  const savedTheme = localStorage.getItem('tgm-theme') || 'dark';
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = savedTheme === 'system' ? 'light dark' : savedTheme;
  }
} catch {
  // Ignore storage access errors
}
