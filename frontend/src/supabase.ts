import "react-native-url-polyfill/auto";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

// Storage adapter — Secure Store on native (with chunking for large tokens, max 2KB per entry)
// and AsyncStorage on web (SecureStore is native-only)
const CHUNK = 1800;

const NativeAdapter = {
  async getItem(key: string) {
    const meta = await SecureStore.getItemAsync(key + "__meta");
    if (!meta) {
      // single value (backward compatible)
      return SecureStore.getItemAsync(key);
    }
    const count = parseInt(meta, 10);
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const p = await SecureStore.getItemAsync(`${key}__${i}`);
      if (p === null) return null;
      parts.push(p);
    }
    return parts.join("");
  },
  async setItem(key: string, value: string) {
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      await SecureStore.deleteItemAsync(key + "__meta").catch(() => {});
      return;
    }
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK) chunks.push(value.slice(i, i + CHUNK));
    await SecureStore.setItemAsync(key + "__meta", String(chunks.length));
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, chunks[i]);
    }
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
  async removeItem(key: string) {
    const meta = await SecureStore.getItemAsync(key + "__meta");
    if (meta) {
      const n = parseInt(meta, 10);
      for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}__${i}`).catch(() => {});
      await SecureStore.deleteItemAsync(key + "__meta").catch(() => {});
    }
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
};

const storage = Platform.OS === "web" ? AsyncStorage : (NativeAdapter as any);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    storageKey: "anam-supabase-auth",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: Platform.OS === "web",
  },
});
