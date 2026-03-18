import { client } from "../../lib/api/client.gen";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

client.setConfig({
  baseUrl: apiBaseUrl || undefined,
  credentials: "include",
});

export { client };
