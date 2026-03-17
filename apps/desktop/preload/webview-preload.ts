import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("nexuDesktop", {
  skillhub: {
    getCatalog: () =>
      ipcRenderer.invoke("host:invoke", "skillhub:get-catalog", undefined),
    install: (slug: string) =>
      ipcRenderer.invoke("host:invoke", "skillhub:install", { slug }),
    uninstall: (slug: string) =>
      ipcRenderer.invoke("host:invoke", "skillhub:uninstall", { slug }),
    refreshCatalog: () =>
      ipcRenderer.invoke("host:invoke", "skillhub:refresh-catalog", undefined),
  },
});
