// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  interface Window {
    appTheme: {
      choices: { value: string; label: string }[];
      get(): string;
      set(value: string): void;
    };
  }

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
