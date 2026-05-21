// Thin re-export so existing call sites keep working unchanged.
// The actual state lives in a single context provider mounted at the app root.
export {
  useUserSettingsContext as useUserSettings,
  type UserSettings,
} from "@/contexts/UserSettingsContext";
