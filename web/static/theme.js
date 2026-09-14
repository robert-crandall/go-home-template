// A blocking head script so a saved theme applies before the first paint.
// The picker uses this same API, rather than duplicating the boot algorithm.
(() => {
  const choices = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];
  let preference = 'system';

  function apply() {
    if (preference === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.dataset.theme = preference;
    }
  }

  try {
    const saved = localStorage.getItem('theme');
    if (saved && choices.some((choice) => choice.value === saved)) preference = saved;
  } catch (error) {
    console.warn('Could not read the saved theme; using System.', error);
  }
  apply();

  window.appTheme = {
    choices,
    get: () => preference,
    set(value) {
      if (!choices.some((choice) => choice.value === value)) {
        throw new Error(`Unknown theme: ${value}`);
      }
      preference = value;
      apply();
      try {
        if (value === 'system') localStorage.removeItem('theme');
        else localStorage.setItem('theme', value);
      } catch (error) {
        console.warn('Could not save the theme; it will reset when this page reloads.', error);
      }
    }
  };
})();
