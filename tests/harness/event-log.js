// Shared by all harness pages: records page-observed events so tests assert real effects.
window.__eventLog = [];
for (const type of ['input', 'change', 'click']) {
  document.addEventListener(
    type,
    (e) => {
      const t = e.target;
      window.__eventLog.push({
        type,
        target: t && t.id ? t.id : (t && t.name) || (t && t.tagName) || '?',
        value: t && 'value' in t ? String(t.value).slice(0, 100) : undefined,
      });
    },
    true,
  );
}
