import { aiConnectionSchema, type AIConnection } from "./model";
export const AI_SETTINGS_STORAGE = "resume-builder.ai-connection.v1";
type SettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function loadAISettings(storage: SettingsStorage): AIConnection | null {
  try {
    const raw = storage.getItem(AI_SETTINGS_STORAGE);
    if (!raw) return null;
    const parsed = aiConnectionSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    storage.removeItem(AI_SETTINGS_STORAGE);
  } catch {
    /* An unavailable or invalid saved connection must not block the app. */
  }
  return null;
}
export function saveAISettings(
  storage: SettingsStorage,
  connection: AIConnection | null,
): boolean {
  try {
    if (connection)
      storage.setItem(
        AI_SETTINGS_STORAGE,
        JSON.stringify(aiConnectionSchema.parse(connection)),
      );
    else storage.removeItem(AI_SETTINGS_STORAGE);
    return true;
  } catch {
    return false;
  }
}
