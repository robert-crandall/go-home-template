import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

// Read source from disk: Tailwind can transform CSS even on Vite's ?raw path.
const themes = readFileSync('src/themes.css', 'utf8');
const tokens = new Set(themes.match(/--[\w-]+(?=\s*:)/g));
for (const role of ['base-100', 'base-200', 'base-300', 'base-content', 'primary', 'secondary',
  'accent', 'neutral', 'info', 'success', 'warning', 'error']) {
  tokens.add(`--color-${role}`);
  if (!role.startsWith('base-')) tokens.add(`--color-${role}-content`);
}
for (const role of ['--radius-field', '--radius-box', '--radius-selector', '--border']) tokens.add(role);

// Deliberately small: extend this for an actual layout or component, not every
// Tailwind escape hatch. Numeric visual scales are not semantic app roles.
const structural = new Set([
  'block', 'inline', 'inline-block', 'hidden', 'flex', 'inline-flex', 'grid',
  'flex-col', 'flex-row', 'flex-wrap', 'flex-1', 'grow', 'shrink-0',
  'items-start', 'items-center', 'items-end', 'justify-start', 'justify-center',
  'justify-end', 'justify-between', 'w-full', 'h-full', 'min-w-0', 'mx-auto',
  'text-left', 'text-center', 'text-right', 'sr-only'
]);
const components = new Set([
  'btn', 'input', 'select', 'alert',
  ...['primary', 'secondary', 'accent', 'neutral', 'info', 'success', 'warning', 'error']
    .flatMap((role) => [`btn-${role}`, `input-${role}`, `select-${role}`, `alert-${role}`])
]);
const utilityTokens: [RegExp, string][] = [
  [/^(?:p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?)-(.+)$/, '--spacing-'],
  [/^(?:bg|text|border|outline)-(.+)$/, '--color-'],
  [/^text-(.+)$/, '--text-'],
  [/^font-(.+)$/, '--font-'],
  [/^font-(.+)$/, '--font-weight-'],
  [/^max-w-(.+)$/, '--container-'],
  [/^rounded-(.+)$/, '--radius-'],
  [/^shadow-(.+)$/, '--shadow-']
];

function approvedClass(value: string) {
  if (value.split(':').some((part) => part === 'dark' || part.includes('['))) return false;
  const name = value.split(':').at(-1) ?? '';
  return structural.has(name) || components.has(name) || utilityTokens.some(([pattern, prefix]) => {
    const match = name.match(pattern);
    return match !== null && tokens.has(prefix + match[1]);
  });
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
  else if (object(value)) {
    visit(value);
    Object.values(value).forEach((child) => walk(child, visit));
  }
}

function inspect(source: string, css = false): string[] {
  const errors: string[] = [];
  const ast = parse(css ? `<style>${source}</style>` : source, { modern: true });
  const checkClasses = (value: string) => {
    for (const name of value.split(/\s+/).filter(Boolean)) {
      if (!approvedClass(name)) errors.push(`Non-semantic class: ${name}`);
    }
  };
  const checkThemeCondition = (value: unknown) => {
    if (object(value) && typeof value.start === 'number' && typeof value.end === 'number'
      && /theme/i.test(source.slice(value.start, value.end))) {
      errors.push('Components must not branch styles by theme');
    }
  };
  const checkExpression = (value: unknown): void => {
    if (!object(value)) {
      errors.push('Class expressions must contain inspectable literal classes');
    } else if (value.type === 'Literal' && typeof value.value === 'string') {
      checkClasses(value.value);
    } else if (value.type === 'ConditionalExpression') {
      checkThemeCondition(value.test);
      checkExpression(value.consequent);
      checkExpression(value.alternate);
    } else {
      errors.push('Class expressions must contain inspectable literal classes');
    }
  };
  if (!css && ast.css) errors.push('Keep component recipes in app.css and values in themes.css');
  walk(css ? ast.css : ast.fragment, (node) => {
    if (node.type === 'SpreadAttribute') errors.push('Spread attributes can bypass the class/style contract');
    if (node.type === 'StyleDirective' || (node.type === 'Attribute' && node.name === 'style')) {
      errors.push('Inline styling bypasses the theme contract');
    }
    if (node.type === 'ClassDirective' && typeof node.name === 'string') {
      checkClasses(node.name);
      checkThemeCondition(node.expression);
    }
    if (node.type === 'Attribute' && node.name === 'class') {
      const values = Array.isArray(node.value) ? node.value : [node.value];
      for (const value of values) {
        if (object(value) && value.type === 'Text' && typeof value.data === 'string') checkClasses(value.data);
        else if (object(value) && value.type === 'ExpressionTag') checkExpression(value.expression);
        else errors.push('Class expressions must contain inspectable literal classes');
      }
    }
    if (css && node.type === 'Declaration' && typeof node.value === 'string') {
      const remainder = node.value.replace(/var\((--[\w-]+)\)/g, (_, token: string) => {
        if (!tokens.has(token)) errors.push(`Undefined semantic token: ${token}`);
        return '';
      }).trim();
      const structuralValue = ['height', 'width', 'overflow-wrap', 'display'].includes(String(node.property))
        && ['auto', '100%', 'anywhere', 'contents', 'block', 'flex', 'grid'].includes(node.value);
      if (!structuralValue && remainder !== '' && remainder !== 'solid') {
        errors.push(`Non-token CSS: ${node.property}: ${node.value}`);
      }
      if (String(node.property).startsWith('--')) errors.push('Define tokens only in themes.css');
    }
  });
  return errors;
}

describe('theme contract', () => {
  // Scan every component and production CSS file, not just the current screens.
  const files = readdirSync('src', { recursive: true, encoding: 'utf8' });
  it.each(files.filter((file) => file.endsWith('.svelte')))('%s uses semantic styling', (file) => {
    expect(inspect(readFileSync(`src/${file}`, 'utf8'))).toEqual([]);
  });

  it.each(files.filter((file) => file.endsWith('.css') && file !== 'themes.css'
    && !file.startsWith('testing/')))('%s uses token-backed recipes', (file) => {
    expect(inspect(readFileSync(`src/${file}`, 'utf8'), true)).toEqual([]);
  });

  // Mutations matter: a scanner that skips dynamic attributes passes the tree
  // while missing exactly the style regressions this contract is meant to catch.
  it.each([
    '<p class="text-red-500">Error</p>',
    '<p class="dark:text-white">Text</p>',
    '<p class="p-6 rounded-lg shadow-sm text-2xl">Text</p>',
    '<p class="text-base-content/50">Text</p>',
    '<p class="p-[20px]">Text</p>',
    '<p class={active ? "text-primary" : "text-red-500"}>Text</p>',
    '<p class="btn {active ? \'btn-primary\' : \'bg-white\'}">Text</p>',
    '<p class:text-red-500={active}>Text</p>',
    '<p class:btn-primary={theme === "dark"}>Text</p>',
    '<p class={classes}>Text</p>',
    '<p class={`bg-${color}`}>Text</p>',
    '<p {...props}>Text</p>',
    '<p class={theme === "light" ? "text-primary" : "text-secondary"}>Text</p>',
    '<p style="color: red">Text</p>',
    '<p style:color={color}>Text</p>',
    '<p>Text</p><style>p { color: red }</style>'
  ])('rejects %s', (source) => {
    expect(inspect(source).length).toBeGreaterThan(0);
  });

  it.each(['color: red', 'padding: 4px', 'color: var(--undefined)', '--local: 1rem',
    'color: var(--color-primary, red)', 'box-shadow: 0 1px var(--color-primary)'])(
    'rejects literal or undefined recipe %s', (declaration) => {
      expect(inspect(`p { ${declaration} }`, true).length).toBeGreaterThan(0);
    }
  );

  it('accepts semantic state variants and structural layout', () => {
    expect(inspect('<p class="p-page flex gap-field hover:bg-primary text-primary-content">Text</p>'))
      .toEqual([]);
  });
});
