import '@testing-library/svelte/vitest';
import { beforeEach } from 'vitest';
import '../static/theme.js';
import themeScript from '../static/theme.js?raw';

beforeEach(() => {
  localStorage.clear();
  window.eval(themeScript);
});
