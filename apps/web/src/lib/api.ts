import { client } from "../../lib/api/client.gen";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const isElectronRenderer =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
const resolvedApiBaseUrl = isElectronRenderer ? undefined : apiBaseUrl;

client.setConfig({
  baseUrl: resolvedApiBaseUrl || undefined,
  credentials: "include",
});

export { client };
