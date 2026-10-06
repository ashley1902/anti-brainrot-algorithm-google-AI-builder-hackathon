/**
 * settings.ts
 *
 * Reads and writes user settings via chrome.storage.local.
 * Only non-sensitive preferences are stored here.
 * Raw content, model output, and session metrics are NEVER written to storage.
 */

import type { Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

const STORAGE_KEY = "abr_settings";

export async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY];
      if (stored && typeof stored === "object") {
        resolve({ ...DEFAULT_SETTINGS, ...stored } as Settings);
      } else {
        resolve(DEFAULT_SETTINGS);
      }
    });
  });
}

export async function saveSettings(settings: Settings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: settings }, resolve);
  });
}

export async function clearSettings(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEY, resolve);
  });
}
