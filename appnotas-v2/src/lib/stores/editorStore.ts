import { writable } from 'svelte/store';

export const currentEditor = writable<any>(null);
