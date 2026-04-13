import { GitHubStarCta } from "@/components/github-star-cta";
import { ModelPickerDropdown } from "@/components/model-picker-dropdown";
import { ModelLogo, ProviderLogo } from "@/components/provider-logo";
import { useAutoUpdate } from "@/hooks/use-auto-update";
import {
  syncDesktopCloudQueries,
  useDesktopCloudStatus,
} from "@/hooks/use-desktop-cloud-status";
import { useGitHubStars } from "@/hooks/use-github-stars";
import { useLocale } from "@/hooks/use-locale";
import { getAnalyticsAppMetadata } from "@/lib/analytics-app-metadata";
import {
  openExternalUrl,
  openLocalFolderUrl,
  pathToFileUrl,
} from "@/lib/desktop-links";
import {
  ANALYTICS_PREFERENCE_STORAGE_KEY,
  disableAnalytics,
  initializeAnalytics,
  track,
} from "@/lib/tracking";
import { cn } from "@/lib/utils";
import {
  type ProviderRegistryEntryDto,
  buildCustomProviderKey,
  customProviderTemplateIds,
  getProviderAliasCandidates,
  normalizeProviderId,
  parseCustomProviderKey,
  selectPreferredModel,
} from "@nexu/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  FolderOpen,
  Globe,
  Info,
  Loader2,
  LogIn,
  Monitor,
  RefreshCw,
  Shield,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  deleteApiV1ModelProvidersMinimaxOauthLogin,
  getApiInternalDesktopDefaultModel,
  getApiInternalDesktopPreferences,
  getApiInternalDesktopReady,
  getApiV1ModelProvidersByProviderIdOauthProviderStatus,
  getApiV1ModelProvidersByProviderIdOauthStatus,
  getApiV1ModelProvidersConfig,
  getApiV1ModelProvidersMinimaxOauthStatus,
  getApiV1ModelProvidersRegistry,
  getApiV1Models,
  patchApiInternalDesktopPreferences,
  postApiInternalDesktopCloudConnect,
  postApiInternalDesktopCloudDisconnect,
  postApiInternalDesktopCloudRefresh,
  postApiV1ModelProvidersByProviderIdOauthDisconnect,
  postApiV1ModelProvidersByProviderIdOauthStart,
  postApiV1ModelProvidersByProviderIdValidate,
  postApiV1ModelProvidersInstancesValidate,
  postApiV1ModelProvidersMinimaxOauthLogin,
  putApiInternalDesktopDefaultModel,
  putApiV1ModelProvidersConfig,
} from "../../lib/api/sdk.gen";
import type {
  PostApiV1ModelProvidersByProviderIdValidateData,
  PutApiV1ModelProvidersConfigData,
} from "../../lib/api/types.gen";
import { Button } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { markSetupComplete } from "./welcome";

// ── Types ──────────────────────────────────────────────────────

interface ProviderModel {
  id: string;
  name: string;
  description?: string;
}

interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  managed: boolean; // true = platform provides API key
  apiDocsUrl?: string;
  models: ProviderModel[];
}

type SidebarItem = {
  id: string;
  name: string;
  modelCount: number;
  configured: boolean;
  managed: boolean;
  kind: "managed" | "builtin-byok" | "custom-byok" | "custom-draft";
  providerKey?: string;
  registryEntry?: ByokProviderEntry;
  draftId?: string;
};

type StoredModelsConfig = NonNullable<PutApiV1ModelProvidersConfigData["body"]>;
type StoredProviderConfig = NonNullable<
  StoredModelsConfig["providers"]
>[string];
type CustomProviderTemplateId = (typeof customProviderTemplateIds)[number];
type CustomProviderDraft = {
  id: string;
  templateId: CustomProviderTemplateId;
  instanceId: string;
  displayName: string;
  baseUrl: string;
};

type MiniMaxDesktopOauthStatus = {
  connected: boolean;
  inProgress: boolean;
  region?: "global" | "cn" | null;
  error?: string | null;
};

type MiniMaxDesktopOauthStartResult = MiniMaxDesktopOauthStatus & {
  started: boolean;
  browserUrl?: string;
};

type MiniMaxDesktopOauthCancelResult = MiniMaxDesktopOauthStatus & {
  cancelled: boolean;
};

function getDefaultMiniMaxAuthMode(
  provider: ProviderRegistryEntryDto,
  providerConfig?: StoredProviderConfig,
): "apiKey" | "oauth" {
  if (providerConfig?.auth === "oauth") {
    return "oauth";
  }
  if (providerConfig?.apiKey) {
    return "apiKey";
  }
  if (providerConfig?.oauthProfileRef) {
    return "oauth";
  }

  return provider.requiresOauthRegion ? "oauth" : "apiKey";
}

function getProviderDisplayName(
  provider: Pick<ProviderRegistryEntryDto, "displayName" | "displayNameKey">,
  t: (key: string) => string,
): string {
  return provider.displayNameKey
    ? t(provider.displayNameKey)
    : provider.displayName;
}

function setMiniMaxOauthErrorInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  error: Error,
) {
  queryClient.setQueryData<MiniMaxDesktopOauthStatus>(
    ["minimax-oauth-status"],
    (previous) => ({
      connected: previous?.connected ?? false,
      inProgress: false,
      region: previous?.region ?? null,
      error: error.message,
    }),
  );
}

type ModelsHostInvokeBridge = {
  invoke: {
    (
      channel: "desktop:get-minimax-oauth-status",
      payload: undefined,
    ): Promise<MiniMaxDesktopOauthStatus>;
    (
      channel: "desktop:start-minimax-oauth",
      payload: { region: "global" | "cn" },
    ): Promise<MiniMaxDesktopOauthStartResult>;
    (
      channel: "desktop:cancel-minimax-oauth",
      payload: undefined,
    ): Promise<MiniMaxDesktopOauthCancelResult>;
    (
      channel: "shell:open-external",
      payload: { url: string },
    ): Promise<{ ok: boolean }>;
    (
      channel: "update:get-current-version",
      payload: undefined,
    ): Promise<{ version: string }>;
    (
      channel: "desktop:get-shell-preferences",
      payload: undefined,
    ): Promise<DesktopShellPreferences>;
    (
      channel: "desktop:update-shell-preferences",
      payload: { launchAtLogin?: boolean; showInDock?: boolean },
    ): Promise<DesktopShellPreferences>;
  };
};

type DesktopShellPreferences = {
  launchAtLogin: boolean;
  showInDock: boolean;
  supportsLaunchAtLogin: boolean;
  supportsShowInDock: boolean;
};

function getModelsHostInvokeBridge(): ModelsHostInvokeBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (window as Window & { nexuHost?: unknown }).nexuHost;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const invoke = Reflect.get(candidate, "invoke");
  if (typeof invoke !== "function") {
    return null;
  }

  return {
    invoke: ((channel: string, payload: unknown) =>
      invoke.call(
        candidate,
        channel as never,
        payload as never,
      )) as ModelsHostInvokeBridge["invoke"],
  };
}

function getModelDisplayLabel(modelId: string): string {
  return modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;
}

export function isModelSelected(
  modelId: string,
  currentModelId: string,
): boolean {
  if (modelId === currentModelId) {
    return true;
  }

  if (getModelDisplayLabel(modelId) !== getModelDisplayLabel(currentModelId)) {
    return false;
  }

  return modelId.includes("/") !== currentModelId.includes("/");
}

function normalizeByokModelSelectionKey(
  providerKey: string,
  modelId: string,
): string {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (normalizedModelId.length === 0) {
    return normalizedModelId;
  }

  const normalizedProviderKey = providerKey.trim().toLowerCase();
  return normalizedModelId.startsWith(`${normalizedProviderKey}/`)
    ? normalizedModelId
    : `${normalizedProviderKey}/${normalizedModelId}`;
}

function isByokModelSelected(
  providerKey: string,
  modelId: string,
  currentModelId: string,
): boolean {
  return (
    normalizeByokModelSelectionKey(providerKey, modelId) ===
    normalizeByokModelSelectionKey(providerKey, currentModelId)
  );
}

function getProviderIdFromModelId(
  models: Array<{ id: string; provider: string }>,
  modelId: string,
): string | null {
  const matched = models.find((model) => model.id === modelId);
  if (matched) {
    return matched.provider;
  }
  if (!modelId.includes("/")) {
    return null;
  }
  const [provider] = modelId.split("/");
  return provider || null;
}

export function getSettingsProviderSelectionIdForModel(
  providerIds: string[],
  models: Array<{ id: string; provider: string }>,
  modelId: string,
): string | null {
  const providerId = getProviderIdFromModelId(models, modelId);
  if (!providerId) {
    return null;
  }

  const normalizedProviderId = normalizeProviderId(providerId) ?? providerId;
  if (providerIds.includes(providerId)) {
    return providerId;
  }
  if (providerIds.includes(normalizedProviderId)) {
    return normalizedProviderId;
  }

  return (
    providerIds.find((candidateId) =>
      getProviderAliasCandidates(candidateId).includes(providerId),
    ) ?? normalizedProviderId
  );
}

type SettingsTab = "general" | "providers";

function isSettingsTab(value: string | null): value is SettingsTab {
  return value === "general" || value === "providers";
}

const ZAI_CODING_PLAN_MODELS = [
  "glm-5",
  "glm-4.7",
  "glm-4.7-flash",
  "glm-4.7-flashx",
];

function buildProviders(
  apiModels: Array<{
    id: string;
    name: string;
    provider: string;
    isDefault?: boolean;
    description?: string;
  }>,
  registryEntries: ProviderRegistryEntryDto[],
): ProviderConfig[] {
  const registryEntryMap = new Map(
    registryEntries.map((entry) => [entry.id, entry] as const),
  );

  // Group models by provider
  const grouped = new Map<string, ProviderModel[]>();
  for (const m of apiModels) {
    const normalizedProviderId = normalizeProviderId(m.provider) ?? m.provider;
    const list = grouped.get(normalizedProviderId) ?? [];
    list.push({
      id: m.id,
      name: m.name,
      description: m.description,
    });
    grouped.set(normalizedProviderId, list);
  }

  return Array.from(grouped.entries()).map(([providerId, models]) => {
    const meta = registryEntryMap.get(providerId) ?? null;
    return {
      id: providerId,
      name: meta?.displayName ?? providerId,
      description: meta?.descriptionKey ?? "",
      managed: providerId === "nexu",
      apiDocsUrl: meta?.apiDocsUrl,
      models,
    };
  });
}

// ── API helpers ───────────────────────────────────────────────

async function fetchProviderRegistry(): Promise<ProviderRegistryEntryDto[]> {
  const { data } = await getApiV1ModelProvidersRegistry();
  return data?.registry ?? [];
}

async function fetchModelProviderConfig(): Promise<StoredModelsConfig> {
  const { data } = await getApiV1ModelProvidersConfig();
  return (data?.config ?? {
    mode: "merge",
    providers: {},
  }) as StoredModelsConfig;
}

async function saveModelProviderConfig(
  config: StoredModelsConfig,
): Promise<StoredModelsConfig> {
  const { data, error } = await putApiV1ModelProvidersConfig({
    body: config,
  });
  if (error || !data) {
    throw new Error("Failed to save model provider config");
  }
  return data.config;
}

async function verifyApiKey(
  providerKey: string,
  providerId: ByokProviderId,
  apiKey?: string,
  baseUrl?: string,
): Promise<{ valid: boolean; models?: string[]; error?: string }> {
  const customProvider = parseCustomProviderKey(providerKey);
  const { data, error } = customProvider
    ? await postApiV1ModelProvidersInstancesValidate({
        body: { instanceKey: providerKey, apiKey, baseUrl },
      })
    : await postApiV1ModelProvidersByProviderIdValidate({
        path: { providerId },
        body: { apiKey, baseUrl },
      });
  if (error || !data) throw new Error("Verify request failed");
  return data;
}

function normalizeVerifiedModelIds(models: unknown[] | undefined): string[] {
  if (!models) {
    return [];
  }

  return models
    .map((model) => {
      if (typeof model === "string") {
        return model;
      }
      if (
        model &&
        typeof model === "object" &&
        "id" in model &&
        typeof model.id === "string"
      ) {
        return model.id;
      }
      return null;
    })
    .filter((modelId): modelId is string => Boolean(modelId));
}

// ── BYOK provider sidebar entries ─────────────────────────────
// Always show these four as configurable, even if no key set yet

const OLLAMA_DUMMY_API_KEY = "ollama-local";

type ConfigurableProviderId =
  PostApiV1ModelProvidersByProviderIdValidateData["path"]["providerId"];
type ByokProviderId = ConfigurableProviderId;

type ByokProviderEntry = ProviderRegistryEntryDto & {
  id: ByokProviderId;
};

function getProviderDefaultBaseUrl(provider: ProviderRegistryEntryDto): string {
  return provider.defaultProxyUrl ?? provider.defaultBaseUrls[0] ?? "";
}

function getProviderConfigMatch(
  config: StoredModelsConfig | undefined,
  providerId: string,
): { key: string; config: StoredProviderConfig } | null {
  const providers = config?.providers ?? {};
  const candidateIds = new Set(getProviderAliasCandidates(providerId));

  for (const [key, value] of Object.entries(providers)) {
    if (candidateIds.has(key) || normalizeProviderId(key) === providerId) {
      return { key, config: value as StoredProviderConfig };
    }
  }

  return null;
}

function hasSavedProviderCredential(
  providerConfig?: StoredProviderConfig,
): boolean {
  return Boolean(providerConfig?.apiKey || providerConfig?.oauthProfileRef);
}

function isStoredProviderConfigured(
  providerConfig?: StoredProviderConfig,
): boolean {
  if (!providerConfig || providerConfig.enabled === false) {
    return false;
  }

  return Boolean(
    providerConfig.baseUrl ||
      (providerConfig.models?.length ?? 0) > 0 ||
      hasSavedProviderCredential(providerConfig),
  );
}

function buildStoredModels(
  provider: ProviderRegistryEntryDto,
  modelIds: string[],
): StoredProviderConfig["models"] {
  return modelIds.map((modelId) => ({
    id: modelId,
    name: modelId,
    api: provider.apiKind,
  }));
}

function buildStoredModelsConfig(
  currentConfig: StoredModelsConfig | undefined,
  providers: NonNullable<StoredModelsConfig["providers"]>,
): StoredModelsConfig {
  return {
    mode: currentConfig?.mode ?? "merge",
    providers,
    ...(currentConfig?.bedrockDiscovery
      ? { bedrockDiscovery: currentConfig.bedrockDiscovery }
      : {}),
  };
}

function getCustomProviderTemplateLabel(
  templateId: CustomProviderTemplateId,
  t: (key: string) => string,
): string {
  switch (templateId) {
    case "custom-anthropic":
      return t("models.customProvider.compatibilityAnthropic");
    case "custom-openai":
      return t("models.customProvider.compatibilityOpenai");
  }
}

function createCustomProviderDraft(id: string): CustomProviderDraft {
  return {
    id,
    templateId: "custom-openai",
    instanceId: "",
    displayName: "",
    baseUrl: "",
  };
}

// ── Component ──────────────────────────────────────────────────

function _GeneralSettings() {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  const update = useAutoUpdate();
  const queryClient = useQueryClient();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [accountConnecting, setAccountConnecting] = useState(false);
  const [accountDisconnecting, setAccountDisconnecting] = useState(false);
  const [crashReportsEnabled, setCrashReportsEnabled] = useState(true);
  const hostBridge = getModelsHostInvokeBridge();
  const { data: desktopCloudStatus, refetch: refetchDesktopCloudStatus } =
    useDesktopCloudStatus();
  const isWindowsPlatform =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("windows");
  const showInShellLabel = isWindowsPlatform
    ? t("settings.desktop.showInTaskbar")
    : t("settings.desktop.showInDock");
  const showInShellHint = isWindowsPlatform
    ? t("settings.desktop.showInTaskbarHint")
    : t("settings.desktop.showInDockHint");

  const { data: shellPreferences } = useQuery({
    queryKey: ["desktop-shell-preferences"],
    queryFn: async () => {
      if (!hostBridge) {
        return null;
      }

      return hostBridge.invoke("desktop:get-shell-preferences", undefined);
    },
  });

  const updateShellPreferences = useMutation({
    mutationFn: async (input: {
      launchAtLogin?: boolean;
      showInDock?: boolean;
    }) => {
      if (!hostBridge) {
        throw new Error("Desktop host bridge is unavailable.");
      }

      return hostBridge.invoke("desktop:update-shell-preferences", input);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["desktop-shell-preferences"], data);
    },
    onError: () => {
      toast.error(t("settings.desktop.updateFailed"));
    },
  });

  const { data: desktopPreferences } = useQuery({
    queryKey: ["desktop-preferences"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopPreferences();
      return data;
    },
  });

  const updateDesktopPreferences = useMutation({
    mutationFn: async (input: { analyticsEnabled: boolean }) => {
      const response = await patchApiInternalDesktopPreferences({
        body: { analyticsEnabled: input.analyticsEnabled },
      });
      if (!response.data) {
        throw new Error("Desktop preferences update returned no data.");
      }
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["desktop-preferences"], data);
      try {
        localStorage.setItem(
          ANALYTICS_PREFERENCE_STORAGE_KEY,
          data.analyticsEnabled ? "1" : "0",
        );
      } catch {
        // ignore local persistence failures
      }

      if (data.analyticsEnabled) {
        const posthogApiKey = import.meta.env.VITE_POSTHOG_API_KEY;
        if (posthogApiKey) {
          const { appName, appVersion } = getAnalyticsAppMetadata();
          initializeAnalytics({
            apiKey: posthogApiKey,
            apiHost: import.meta.env.VITE_POSTHOG_HOST,
            environment: import.meta.env.MODE,
            appName,
            appVersion,
          });
        }
      } else {
        disableAnalytics();
      }
    },
    onError: () => {
      toast.error(t("settings.desktop.updateFailed"));
    },
  });

  useEffect(() => {
    const hostBridge = getModelsHostInvokeBridge();
    if (!hostBridge) {
      return;
    }

    let cancelled = false;
    void hostBridge
      .invoke("update:get-current-version", undefined)
      .then((result) => {
        if (!cancelled) {
          setAppVersion(result.version);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppVersion(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const cloudConnected = desktopCloudStatus?.connected ?? false;
  const displayEmail =
    desktopCloudStatus?.userEmail?.trim() || t("settings.general.loggedOut");
  const accountActionBusy = accountConnecting || accountDisconnecting;
  const updateAction = (() => {
    switch (update.phase) {
      case "checking":
        return {
          label: t("settings.updates.checking"),
          onClick: () => void update.check(),
          disabled: true,
        };
      case "available":
        return {
          label: t("layout.update.download"),
          onClick: () => void update.download(),
          disabled: false,
        };
      case "downloading":
        return {
          label: t("settings.updates.downloading", {
            percent: Math.round(update.percent),
          }),
          onClick: () => void update.download(),
          disabled: true,
        };
      case "installing":
        return {
          label: t("layout.update.installing"),
          onClick: () => void update.install(),
          disabled: true,
        };
      case "ready":
        return {
          label: t("layout.update.install"),
          onClick: () => void update.install(),
          disabled: false,
        };
      case "error":
        return {
          label: t("settings.updates.retry"),
          onClick: () => void update.check(),
          disabled: false,
        };
      default:
        return {
          label: t("settings.updates.checkNow"),
          onClick: () => void update.check(),
          disabled: false,
        };
    }
  })();
  const updateStatusText = (() => {
    switch (update.phase) {
      case "checking":
        return t("settings.updates.checkingHint");
      case "available":
        return t("layout.update.available", {
          version: update.version ?? appVersion ?? "",
        });
      case "downloading":
        return t("settings.updates.downloadingHint", {
          percent: Math.round(update.percent),
        });
      case "installing":
        return t("layout.update.installing");
      case "ready":
        return t("layout.update.readyToInstall");
      case "error":
        return update.errorMessage ?? t("settings.updates.error");
      default:
        return appVersion ? null : t("settings.updates.versionUnknown");
    }
  })();

  useEffect(() => {
    if (!accountConnecting) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const result = await refetchDesktopCloudStatus();
        if (result.data?.connected) {
          setAccountConnecting(false);
          await syncDesktopCloudQueries(queryClient);
        }
      } catch {
        /* ignore */
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [accountConnecting, queryClient, refetchDesktopCloudStatus]);

  const handleAccountLogin = async () => {
    if (accountActionBusy) {
      return;
    }

    track("welcome_option_click", { option: "nexu_account" });
    setAccountConnecting(true);

    try {
      let { data } = await postApiInternalDesktopCloudConnect({
        body: { source: "settings" },
      });

      if (data?.error === "Already connected. Disconnect first.") {
        await syncDesktopCloudQueries(queryClient);
        setAccountConnecting(false);
        return;
      }

      if (data?.error) {
        await postApiInternalDesktopCloudDisconnect().catch(() => {});
        ({ data } = await postApiInternalDesktopCloudConnect({
          body: { source: "settings" },
        }));
      }

      if (data?.error) {
        toast.error(data.error ?? t("welcome.connectFailed"));
        setAccountConnecting(false);
        return;
      }

      if (data?.browserUrl) {
        await openExternalUrl(data.browserUrl);
        toast.info(t("welcome.browserOpened"));
        return;
      }

      const result = await refetchDesktopCloudStatus();
      if (result.data?.connected) {
        await syncDesktopCloudQueries(queryClient);
        setAccountConnecting(false);
        return;
      }

      setAccountConnecting(false);
    } catch {
      toast.error(t("welcome.cloudConnectError"));
      setAccountConnecting(false);
    }
  };

  const handleAccountLogout = async () => {
    if (accountActionBusy) {
      return;
    }

    setAccountDisconnecting(true);
    try {
      await postApiInternalDesktopCloudDisconnect().catch(() => {});
      await syncDesktopCloudQueries(queryClient);
    } finally {
      setAccountDisconnecting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <User size={14} className="text-text-secondary" />
            <div className="text-[13px] font-semibold text-text-primary">
              {t("settings.general.account")}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-text-primary">
              {displayEmail}
            </div>
            <div className="mt-0.5 text-[11px] text-text-tertiary">
              {cloudConnected
                ? t("settings.general.emailHint")
                : t("settings.general.loggedOutHint")}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={accountActionBusy}
            onClick={() =>
              void (cloudConnected
                ? handleAccountLogout()
                : handleAccountLogin())
            }
          >
            {accountActionBusy
              ? t("common.loading")
              : cloudConnected
                ? t("layout.signOut")
                : t("settings.general.goLogin")}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-text-secondary" />
            <div className="text-[13px] font-semibold text-text-primary">
              {t("settings.general.language")}
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-text-primary">
                {t("settings.general.language")}
              </div>
              <div className="mt-0.5 text-[11px] text-text-tertiary">
                {t("settings.general.languageHint")}
              </div>
            </div>
            <div className="w-full md:w-[220px] md:shrink-0">
              <Select
                value={locale}
                onValueChange={(value) => setLocale(value as "en" | "zh")}
              >
                <SelectTrigger className="h-11 w-full rounded-xl border-border bg-surface-0 px-4 text-[13px] font-medium text-text-primary shadow-none hover:bg-surface-1">
                  <SelectValue>
                    {locale === "zh" ? "中文" : "English"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  align="end"
                  className="rounded-2xl border-border bg-surface-0 text-text-primary shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
                >
                  <SelectItem
                    value="zh"
                    className="rounded-xl px-4 py-2 text-[13px] text-text-secondary focus:bg-surface-2 focus:text-text-primary data-[state=checked]:bg-surface-2 data-[state=checked]:text-text-primary"
                  >
                    中文
                  </SelectItem>
                  <SelectItem
                    value="en"
                    className="rounded-xl px-4 py-2 text-[13px] text-text-secondary focus:bg-surface-2 focus:text-text-primary data-[state=checked]:bg-surface-2 data-[state=checked]:text-text-primary"
                  >
                    English
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {shellPreferences &&
      (shellPreferences.supportsLaunchAtLogin ||
        shellPreferences.supportsShowInDock) ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <Monitor size={14} className="text-text-secondary" />
              <div className="text-[13px] font-semibold text-text-primary">
                {t("settings.section.desktop")}
              </div>
            </div>
          </div>
          <div className="divide-y divide-border">
            {shellPreferences.supportsLaunchAtLogin ? (
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-text-primary">
                    {t("settings.desktop.launchAtLogin")}
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-tertiary">
                    {t("settings.desktop.launchAtLoginHint")}
                  </div>
                </div>
                <Switch
                  checked={shellPreferences.launchAtLogin}
                  disabled={updateShellPreferences.isPending}
                  onCheckedChange={(checked) => {
                    void updateShellPreferences.mutateAsync({
                      launchAtLogin: checked,
                    });
                  }}
                />
              </div>
            ) : null}

            {shellPreferences.supportsShowInDock ? (
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-text-primary">
                    {showInShellLabel}
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-tertiary">
                    {showInShellHint}
                  </div>
                </div>
                <Switch
                  checked={shellPreferences.showInDock}
                  disabled={updateShellPreferences.isPending}
                  onCheckedChange={(checked) => {
                    void updateShellPreferences.mutateAsync({
                      showInDock: checked,
                    });
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-text-secondary" />
            <div className="text-[13px] font-semibold text-text-primary">
              {t("settings.section.data")}
            </div>
          </div>
        </div>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-text-primary">
                {t("settings.data.analytics")}
              </div>
              <div className="mt-0.5 text-[11px] text-text-tertiary">
                {t("settings.data.analyticsHint")}
              </div>
            </div>
            <Switch
              checked={desktopPreferences?.analyticsEnabled ?? true}
              disabled={updateDesktopPreferences.isPending}
              onCheckedChange={(checked) => {
                void updateDesktopPreferences.mutateAsync({
                  analyticsEnabled: checked,
                });
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-text-primary">
                {t("settings.data.crashReports")}
              </div>
              <div className="mt-0.5 text-[11px] text-text-tertiary">
                {t("settings.data.crashReportsHint")}
              </div>
            </div>
            <Switch
              checked={crashReportsEnabled}
              onCheckedChange={setCrashReportsEnabled}
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <RefreshCw size={14} className="text-text-secondary" />
            <div className="text-[13px] font-semibold text-text-primary">
              {t("settings.section.updates")}
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-text-primary">
                {t("settings.updates.version")}
              </div>
              <div className="mt-0.5 text-[11px] text-text-tertiary">
                {appVersion ?? "—"}
              </div>
              {updateStatusText ? (
                <div
                  className={cn(
                    "mt-2 text-[11px]",
                    update.phase === "error"
                      ? "text-[var(--color-danger)]"
                      : "text-text-tertiary",
                  )}
                >
                  {updateStatusText}
                </div>
              ) : null}
              {(update.phase === "downloading" ||
                update.phase === "installing") && (
                <div className="mt-3 h-1.5 w-full max-w-[240px] overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-[var(--color-brand-primary)] transition-all duration-300 ease-out"
                    style={{
                      width:
                        update.phase === "installing"
                          ? "100%"
                          : `${Math.round(update.percent)}%`,
                    }}
                  />
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={updateAction.disabled}
              onClick={updateAction.onClick}
            >
              {update.phase === "checking" ||
              update.phase === "downloading" ||
              update.phase === "installing" ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {updateAction.label}
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-text-secondary" />
            <div className="text-[13px] font-semibold text-text-primary">
              {t("settings.section.about")}
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent/10 to-accent/5">
              <img
                src="/brand/logo-black-1.svg"
                alt="nexu"
                className="h-6 w-6 object-contain"
              />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-text-primary">
                nexu
              </div>
              <div className="text-[11px] text-text-tertiary">
                {appVersion ?? "Desktop client"}
              </div>
            </div>
          </div>
          <div className="space-y-1">
            {[
              { label: t("settings.about.docs"), url: "https://docs.nexu.io" },
              {
                label: t("settings.about.github"),
                url: "https://github.com/nexu-io/nexu",
              },
              {
                label: t("settings.about.changelog"),
                url: "https://github.com/nexu-io/nexu/releases",
              },
              {
                label: t("settings.about.feedback"),
                url: "https://github.com/nexu-io/nexu/issues/new",
              },
            ].map((link) => (
              <button
                key={link.label}
                type="button"
                onClick={() => void openExternalUrl(link.url)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
              >
                <ExternalLink size={13} className="shrink-0 text-text-muted" />
                {link.label}
                <ArrowUpRight
                  size={10}
                  className="ml-auto shrink-0 text-text-muted"
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// _CurrentModelSelector removed — model switching now lives inline in each provider's model list

function AddCustomProviderDetail({
  draft,
  customTemplates,
  onChange,
  onCreate,
  onRemove,
}: {
  draft: CustomProviderDraft;
  customTemplates: ByokProviderEntry[];
  onChange: (draft: CustomProviderDraft) => void;
  onCreate: (input: {
    template: ByokProviderEntry;
    instanceId: string;
    displayName: string;
    baseUrl: string;
  }) => Promise<void>;
  onRemove: () => void;
}) {
  const { t } = useTranslation();

  const template = useMemo(
    () => customTemplates.find((item) => item.id === draft.templateId) ?? null,
    [customTemplates, draft.templateId],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!template) {
        throw new Error("Custom provider template not found");
      }

      await onCreate({
        template,
        instanceId: draft.instanceId.trim(),
        displayName:
          draft.displayName.trim() ||
          `${getCustomProviderTemplateLabel(draft.templateId, t)} / ${draft.instanceId.trim()}`,
        baseUrl: draft.baseUrl.trim(),
      });
    },
    onError: (error) => {
      toast.error(error.message || t("models.customProvider.createFailed"));
    },
  });

  const canCreate = Boolean(
    template && draft.instanceId.trim() && draft.baseUrl.trim(),
  );

  return (
    <div className="max-w-lg space-y-4">
      <div className="text-[14px] font-semibold text-text-primary">
        {t("models.customProvider.title")}
      </div>
      <div className="space-y-3">
        <div>
          <label
            htmlFor="custom-provider-template"
            className="mb-1.5 block text-[12px] font-medium text-text-secondary"
          >
            {t("models.customProvider.compatibility")}
          </label>
          <Select
            value={draft.templateId}
            onValueChange={(value) =>
              onChange({
                ...draft,
                templateId: value as CustomProviderTemplateId,
              })
            }
          >
            <SelectTrigger id="custom-provider-template" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {customTemplates.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {getCustomProviderTemplateLabel(
                    item.id as CustomProviderTemplateId,
                    t,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label
            htmlFor="custom-provider-instance-id"
            className="mb-1.5 block text-[12px] font-medium text-text-secondary"
          >
            {t("models.customProvider.instanceId")}
          </label>
          <input
            id="custom-provider-instance-id"
            type="text"
            value={draft.instanceId}
            onChange={(event) =>
              onChange({ ...draft, instanceId: event.target.value })
            }
            placeholder={t("models.customProvider.instanceIdPlaceholder")}
            className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary"
          />
        </div>
        <div>
          <label
            htmlFor="custom-provider-display-name"
            className="mb-1.5 block text-[12px] font-medium text-text-secondary"
          >
            {t("models.customProvider.displayName")}
          </label>
          <input
            id="custom-provider-display-name"
            type="text"
            value={draft.displayName}
            onChange={(event) =>
              onChange({ ...draft, displayName: event.target.value })
            }
            placeholder={t("models.customProvider.displayNamePlaceholder")}
            className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary"
          />
        </div>
        <div>
          <label
            htmlFor="custom-provider-base-url"
            className="mb-1.5 block text-[12px] font-medium text-text-secondary"
          >
            {t("models.customProvider.baseUrl")}
          </label>
          <input
            id="custom-provider-base-url"
            type="text"
            value={draft.baseUrl}
            onChange={(event) =>
              onChange({ ...draft, baseUrl: event.target.value })
            }
            placeholder={t("models.customProvider.baseUrlPlaceholder")}
            className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canCreate || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className={cn(
            "rounded-lg px-4 py-2 text-[12px] font-medium transition-colors",
            canCreate && !createMutation.isPending
              ? "bg-accent text-accent-fg hover:bg-accent/90"
              : "bg-surface-2 text-text-muted cursor-not-allowed",
          )}
        >
          {createMutation.isPending
            ? t("models.customProvider.creating")
            : t("models.customProvider.create")}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          {t("models.customProvider.removeDraft")}
        </button>
      </div>
    </div>
  );
}

export function ModelsPage() {
  const { t } = useTranslation();
  const { stars: starNexu } = useGitHubStars();
  const isDesktopClient = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron"),
    [],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const isSetupMode = searchParams.get("setup") === "1";
  const tabParam = searchParams.get("tab");
  const settingsTab = isSettingsTab(tabParam)
    ? tabParam
    : isSetupMode
      ? "providers"
      : "general";
  const providerParam = searchParams.get("provider");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    providerParam ?? (isSetupMode ? "anthropic" : null),
  );
  const [customProviderDrafts, setCustomProviderDrafts] = useState<
    CustomProviderDraft[]
  >([]);

  const queryClient = useQueryClient();

  const {
    data: modelsData,
    isLoading: modelsLoading,
    isError: modelsError,
  } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data } = await getApiV1Models();
      return data;
    },
  });

  const { data: providerRegistry = [] } = useQuery({
    queryKey: ["model-provider-registry"],
    queryFn: fetchProviderRegistry,
  });

  const { data: providerConfigDoc } = useQuery({
    queryKey: ["model-provider-config"],
    queryFn: fetchModelProviderConfig,
  });

  // Current default model
  const { data: defaultModelData } = useQuery({
    queryKey: ["desktop-default-model"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopDefaultModel();
      return data as { modelId: string | null } | undefined;
    },
  });

  const currentModelId = defaultModelData?.modelId ?? "";
  const models = modelsData?.models ?? [];
  const visibleRegistryProviders = useMemo(
    () =>
      providerRegistry.filter(
        (entry): entry is ByokProviderEntry =>
          entry.modelsPageVisible === true &&
          entry.controllerConfigurable === true,
      ),
    [providerRegistry],
  );
  const visibleRegistryProviderMap = useMemo(
    () => new Map(visibleRegistryProviders.map((entry) => [entry.id, entry])),
    [visibleRegistryProviders],
  );
  const { data: desktopReadyData } = useQuery({
    queryKey: ["desktop-ready"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopReady();
      return data;
    },
  });
  const saveProviderConfigMutation = useMutation({
    mutationFn: saveModelProviderConfig,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["model-provider-config"] }),
        queryClient.invalidateQueries({ queryKey: ["models"] }),
        queryClient.invalidateQueries({ queryKey: ["desktop-default-model"] }),
      ]);
    },
  });

  const upsertProviderConfigByKey = useCallback(
    async (providerKey: string, nextProviderConfig: StoredProviderConfig) => {
      if (!providerConfigDoc) {
        throw new Error("Model provider config is still loading");
      }

      const currentProviders = { ...(providerConfigDoc?.providers ?? {}) };
      currentProviders[providerKey] = nextProviderConfig;

      await saveProviderConfigMutation.mutateAsync(
        buildStoredModelsConfig(providerConfigDoc, currentProviders),
      );
    },
    [providerConfigDoc, saveProviderConfigMutation],
  );

  const removeProviderConfigByKey = useCallback(
    async (providerKey: string) => {
      if (!providerConfigDoc) {
        throw new Error("Model provider config is still loading");
      }

      const currentProviders = { ...(providerConfigDoc?.providers ?? {}) };
      delete currentProviders[providerKey];

      await saveProviderConfigMutation.mutateAsync(
        buildStoredModelsConfig(providerConfigDoc, currentProviders),
      );
    },
    [providerConfigDoc, saveProviderConfigMutation],
  );

  const upsertBuiltinProviderConfig = useCallback(
    async (
      provider: ByokProviderEntry,
      nextProviderConfig: StoredProviderConfig,
    ) => {
      const matchedProvider = getProviderConfigMatch(
        providerConfigDoc,
        provider.id,
      );
      await upsertProviderConfigByKey(
        matchedProvider?.key ?? provider.id,
        nextProviderConfig,
      );
    },
    [providerConfigDoc, upsertProviderConfigByKey],
  );

  const removeBuiltinProviderConfig = useCallback(
    async (provider: ByokProviderEntry) => {
      const matchedProvider = getProviderConfigMatch(
        providerConfigDoc,
        provider.id,
      );
      if (!matchedProvider) {
        return;
      }
      await removeProviderConfigByKey(matchedProvider.key);
    },
    [providerConfigDoc, removeProviderConfigByKey],
  );

  const userSwitchRef = useRef(false);
  const updateModel = useMutation({
    mutationFn: async (modelId: string) => {
      userSwitchRef.current = true;
      const toastId = toast.loading(t("models.switchingModel"));
      const { error } = await putApiInternalDesktopDefaultModel({
        body: { modelId },
      });
      if (error) {
        toast.error(t("models.modelSwitchFailed"), { id: toastId });
        throw new Error("Failed to update model");
      }
      toast.success(t("models.modelSwitched"), { id: toastId });
    },
    onSuccess: (_, modelId) => {
      track("workspace_change_model_change", {
        previous_provider_name: getProviderIdFromModelId(
          models,
          currentModelId,
        ),
        previous_model_name: currentModelId || null,
        provider_name: getProviderIdFromModelId(models, modelId),
        model_name: modelId,
      });
      queryClient.invalidateQueries({ queryKey: ["desktop-default-model"] });
    },
  });

  // Detect backend auto-switch (ensureValidDefaultModel) and toast
  const prevModelIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const newId = defaultModelData?.modelId;
    if (newId === undefined) return;
    const prev = prevModelIdRef.current;
    prevModelIdRef.current = newId ?? undefined;
    if (prev === undefined) return; // skip initial load

    if (newId && newId !== prev && !userSwitchRef.current) {
      const matched = models.find((m) => m.id === newId);
      const matchedProviderId = normalizeProviderId(
        matched?.provider ?? "",
      ) as ByokProviderId | null;
      const providerName =
        (matchedProviderId
          ? visibleRegistryProviderMap.get(matchedProviderId)?.displayName
          : null) ?? matched?.provider;
      const label = providerName
        ? `${matched?.name ?? newId} (${providerName})`
        : (matched?.name ?? newId);
      toast.info(t("models.autoSwitched", { model: label }));
    }
    userSwitchRef.current = false;
  }, [defaultModelData?.modelId, models, t, visibleRegistryProviderMap]);

  const providers = useMemo(
    () => buildProviders(models, providerRegistry),
    [models, providerRegistry],
  );

  const customTemplateRegistryMap = useMemo(() => {
    const map = new Map<string, ByokProviderEntry>();
    for (const templateId of customProviderTemplateIds) {
      const template = providerRegistry.find(
        (entry): entry is ByokProviderEntry => entry.id === templateId,
      );
      if (template) {
        map.set(template.id, template);
      }
    }
    return map;
  }, [providerRegistry]);

  const customProviderInstances = useMemo(() => {
    const entries = providerConfigDoc?.providers
      ? Object.entries(providerConfigDoc.providers)
      : [];
    return entries
      .map(([key, config]) => {
        const parsed = parseCustomProviderKey(key);
        if (!parsed) {
          return null;
        }

        const template = customTemplateRegistryMap.get(parsed.templateId);
        if (!template) {
          return null;
        }

        return {
          key,
          instanceId: parsed.instanceId,
          template,
          config: config as StoredProviderConfig,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [customTemplateRegistryMap, providerConfigDoc?.providers]);

  const removeCustomProviderDraft = useCallback((draftId: string) => {
    setCustomProviderDrafts((previous) =>
      previous.filter((draft) => draft.id !== draftId),
    );
    setSelectedProviderId((current) => (current === draftId ? null : current));
  }, []);

  // Build sidebar items: Nexu first, then built-in BYOK, then custom BYOK
  const sidebarItems = useMemo(() => {
    const items: SidebarItem[] = [];

    // Nexu official — always shown
    const nexuProvider = providers.find((p) => p.id === "nexu");
    items.push({
      id: "nexu",
      name: "nexu Official",
      modelCount: nexuProvider?.models.length ?? 0,
      configured: (nexuProvider?.models.length ?? 0) > 0,
      managed: true,
      kind: "managed",
    });

    // Built-in BYOK providers — always listed
    for (const provider of visibleRegistryProviders) {
      const matchedProviderConfig = getProviderConfigMatch(
        providerConfigDoc,
        provider.id,
      )?.config;
      const modProv = providers.find((p) => p.id === provider.id);
      items.push({
        id: provider.id,
        name: getProviderDisplayName(provider, t),
        modelCount: modProv?.models.length ?? 0,
        configured: isStoredProviderConfigured(matchedProviderConfig),
        managed: false,
        kind: "builtin-byok",
        registryEntry: provider,
      });
    }

    for (const customInstance of customProviderInstances) {
      const modelCount = models.filter((model) =>
        model.id.startsWith(`${customInstance.key}/`),
      ).length;
      items.push({
        id: customInstance.key,
        name:
          customInstance.config.displayName?.trim() ||
          `${customInstance.template.displayName} / ${customInstance.instanceId}`,
        modelCount,
        configured: isStoredProviderConfigured(customInstance.config),
        managed: false,
        kind: "custom-byok",
        providerKey: customInstance.key,
        registryEntry: customInstance.template,
      });
    }

    for (const draft of customProviderDrafts) {
      const template = customTemplateRegistryMap.get(draft.templateId);
      if (!template) {
        continue;
      }

      items.push({
        id: draft.id,
        name:
          draft.displayName.trim() ||
          draft.instanceId.trim() ||
          t("models.customProvider.newProvider"),
        modelCount: 0,
        configured: false,
        managed: false,
        kind: "custom-draft",
        draftId: draft.id,
        registryEntry: template,
      });
    }

    return items;
  }, [
    customProviderDrafts,
    customProviderInstances,
    customTemplateRegistryMap,
    models,
    providerConfigDoc,
    providers,
    t,
    visibleRegistryProviders,
  ]);

  const activeProvider =
    sidebarItems.find((p) => p.id === selectedProviderId) ??
    sidebarItems[0] ??
    null;

  const activeCustomProviderDraft = useMemo(
    () =>
      activeProvider?.kind === "custom-draft"
        ? (customProviderDrafts.find(
            (draft) => draft.id === activeProvider.draftId,
          ) ?? null)
        : null,
    [activeProvider, customProviderDrafts],
  );

  const activeBuiltinProviderMatch = useMemo(
    () =>
      activeProvider?.kind === "builtin-byok" && activeProvider.registryEntry
        ? getProviderConfigMatch(
            providerConfigDoc,
            activeProvider.registryEntry.id,
          )
        : null,
    [activeProvider, providerConfigDoc],
  );

  // Clear setup param once user interacts
  const clearSetupParam = useCallback(() => {
    if (isSetupMode) {
      const next = new URLSearchParams(searchParams);
      next.delete("setup");
      if (!next.get("tab")) {
        next.set("tab", "providers");
      }
      setSearchParams(next, { replace: true });
    }
  }, [isSetupMode, searchParams, setSearchParams]);

  const handleAddCustomProvider = useCallback(() => {
    const draftId = `__custom-provider-draft__${Date.now()}`;
    const nextDraft = createCustomProviderDraft(draftId);
    setCustomProviderDrafts((previous) => [...previous, nextDraft]);
    setSelectedProviderId(draftId);
    clearSetupParam();
  }, [clearSetupParam]);

  const changeSettingsTab = useCallback(
    (tab: SettingsTab) => {
      const next = new URLSearchParams(searchParams);
      next.set("tab", tab);
      next.delete("setup");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Auto-select first model after provider save
  const handleAutoSelectModel = useCallback(
    (firstModelId: string) => {
      if (!currentModelId) {
        updateModel.mutate(firstModelId);
      }
    },
    [currentModelId, updateModel],
  );

  const handleOpenWorkspace = useCallback(async () => {
    if (!desktopReadyData?.workspacePath) {
      toast.error("OpenClaw workspace folder is unavailable.");
      return;
    }

    try {
      await openLocalFolderUrl(pathToFileUrl(desktopReadyData.workspacePath));
    } catch {
      toast.error("Failed to open OpenClaw workspace folder.");
    }
  }, [desktopReadyData?.workspacePath]);

  return (
    <div className="h-full overflow-y-auto">
      <div
        className="max-w-4xl mx-auto px-4 sm:px-6 pb-6 sm:pb-8"
        style={{ paddingTop: isDesktopClient ? "2rem" : "0.5rem" }}
      >
        <div className="mb-6">
          <PageHeader
            title={t("models.pageTitle")}
            description={t("models.pageSubtitle")}
            actions={
              <>
                <GitHubStarCta
                  label={t("home.starGithub")}
                  stars={starNexu}
                  variant="button"
                  onClick={() =>
                    track("workspace_github_click", { source: "settings" })
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void handleOpenWorkspace();
                  }}
                >
                  <FolderOpen size={13} />
                  {t("settings.providers.workspace")}
                </Button>
              </>
            }
          />

          <div className="mt-4 flex items-center gap-0 border-b border-border">
            {[
              { id: "general" as SettingsTab, label: t("settings.tabGeneral") },
              {
                id: "providers" as SettingsTab,
                label: t("settings.tabProviders"),
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => changeSettingsTab(tab.id)}
                className={cn(
                  "relative px-4 py-2.5 text-[13px] font-medium transition-colors",
                  settingsTab === tab.id
                    ? "text-text-primary"
                    : "text-text-muted hover:text-text-secondary",
                )}
              >
                {tab.label}
                {settingsTab === tab.id ? (
                  <span className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full bg-accent" />
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {settingsTab === "general" ? (
          <_GeneralSettings />
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-surface-1 px-4 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent/10 to-accent/5">
                    <img
                      src="/brand/logo-black-1.svg"
                      alt="nexu"
                      className="h-5 w-5 object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-text-primary">
                      {t("settings.providers.botModelTitle")}
                    </div>
                    <div className="text-[11px] text-text-tertiary">
                      {t("settings.providers.botModelDesc")}
                    </div>
                  </div>
                </div>
                <ModelPickerDropdown
                  compact
                  dropdownAlign="end"
                  models={models}
                  currentModelId={currentModelId}
                  emptyLabel={t("models.noModelConfigured")}
                  onSelectModel={(modelId) => {
                    const providerId = getSettingsProviderSelectionIdForModel(
                      sidebarItems.map((item) => item.id),
                      models,
                      modelId,
                    );
                    if (providerId) {
                      setSelectedProviderId(providerId);
                    }
                    clearSetupParam();
                    updateModel.mutate(modelId);
                  }}
                  className="shrink-0"
                  triggerClassName="min-w-[220px] justify-between"
                  dropdownClassName="shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
                />
              </div>
            </div>

            <div
              className="flex gap-0 overflow-hidden rounded-xl border border-border bg-surface-1"
              style={{ minHeight: 500 }}
            >
              {/* Left: Provider list */}
              <div className="w-56 shrink-0 bg-surface-0 flex flex-col border-r border-border-subtle">
                <div className="flex-1 overflow-y-auto p-2">
                  <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                    {t("settings.tabProviders")}
                  </div>
                  <div className="space-y-1">
                    {sidebarItems.map((item) => {
                      const isActive = activeProvider?.id === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setSelectedProviderId(item.id);
                            clearSetupParam();
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors",
                            isActive ? "bg-surface-3" : "hover:bg-surface-2",
                          )}
                        >
                          <span className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md bg-white border border-border-subtle">
                            <ProviderLogo
                              provider={item.registryEntry?.id ?? item.id}
                              size={14}
                            />
                          </span>
                          <span
                            className={cn(
                              "flex-1 text-[12px] truncate",
                              isActive
                                ? "font-semibold text-text-primary"
                                : "font-medium text-text-primary",
                            )}
                          >
                            {item.name}
                          </span>
                          {item.modelCount > 0 ? (
                            <span className="text-[10px] text-text-muted">
                              {item.modelCount}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-border-subtle p-3">
                  <button
                    type="button"
                    onClick={handleAddCustomProvider}
                    className={cn(
                      "w-full inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors",
                      "border-border bg-surface-0 text-text-secondary hover:bg-surface-2 hover:text-text-primary",
                    )}
                  >
                    <span className="text-[14px] leading-none">+</span>
                    {t("models.customProvider.addButton")}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {activeProvider ? (
                  activeProvider.managed ? (
                    modelsLoading ? (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-[13px] text-text-muted">
                          {t("models.loading")}
                        </div>
                      </div>
                    ) : modelsError ? (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                          <div className="text-[13px] text-red-500 mb-2">
                            {t("models.loadFailed")}
                          </div>
                          <p className="text-[12px] text-text-muted mb-3">
                            {t("models.loadFailedHint")}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              queryClient.invalidateQueries({
                                queryKey: ["models"],
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-surface-2 hover:bg-surface-3 text-text-primary transition-colors"
                          >
                            <RefreshCw size={12} />
                            {t("models.retry")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <ManagedProviderDetail
                        provider={
                          providers.find((p) => p.id === activeProvider.id) ?? {
                            id: activeProvider.id,
                            name: activeProvider.name,
                            description: "models.provider.nexu.description",
                            managed: true,
                            models: [],
                          }
                        }
                        currentModelId={currentModelId}
                        onSelectModel={(modelId) => updateModel.mutate(modelId)}
                      />
                    )
                  ) : providerConfigDoc === undefined ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-[13px] text-text-muted">
                        {t("models.loading")}
                      </div>
                    </div>
                  ) : activeProvider.kind === "custom-draft" ? (
                    activeCustomProviderDraft ? (
                      <AddCustomProviderDetail
                        draft={activeCustomProviderDraft}
                        customTemplates={Array.from(
                          customTemplateRegistryMap.values(),
                        )}
                        onChange={(draft) => {
                          setCustomProviderDrafts((previous) =>
                            previous.map((item) =>
                              item.id === draft.id ? draft : item,
                            ),
                          );
                        }}
                        onCreate={async (input) => {
                          const providerKey = buildCustomProviderKey(
                            input.template
                              .id as (typeof customProviderTemplateIds)[number],
                            input.instanceId,
                          );
                          await upsertProviderConfigByKey(providerKey, {
                            providerTemplateId: input.template.id,
                            instanceId: input.instanceId,
                            enabled: true,
                            api: input.template.apiKind,
                            baseUrl: input.baseUrl,
                            displayName: input.displayName,
                            models: [],
                          });
                          removeCustomProviderDraft(
                            activeCustomProviderDraft.id,
                          );
                          setSelectedProviderId(providerKey);
                        }}
                        onRemove={() => {
                          removeCustomProviderDraft(
                            activeCustomProviderDraft.id,
                          );
                        }}
                      />
                    ) : null
                  ) : (
                    <ByokProviderDetail
                      key={
                        activeProvider.providerKey ??
                        activeBuiltinProviderMatch?.key ??
                        (activeProvider.registryEntry as ByokProviderEntry).id
                      }
                      provider={
                        activeProvider.registryEntry as ByokProviderEntry
                      }
                      providerKey={
                        activeProvider.providerKey ??
                        activeBuiltinProviderMatch?.key ??
                        (activeProvider.registryEntry as ByokProviderEntry).id
                      }
                      providerConfig={
                        activeProvider.registryEntry
                          ? activeProvider.providerKey
                            ? providerConfigDoc.providers?.[
                                activeProvider.providerKey
                              ]
                            : activeBuiltinProviderMatch?.config
                          : undefined
                      }
                      onSaveProviderConfig={
                        activeProvider.providerKey
                          ? (_, config) =>
                              upsertProviderConfigByKey(
                                activeProvider.providerKey ?? "",
                                config,
                              )
                          : upsertBuiltinProviderConfig
                      }
                      onDeleteProviderConfig={
                        activeProvider.providerKey
                          ? () =>
                              removeProviderConfigByKey(
                                activeProvider.providerKey ?? "",
                              )
                          : removeBuiltinProviderConfig
                      }
                      queryClient={queryClient}
                      currentModelId={currentModelId}
                      onAutoSelectModel={handleAutoSelectModel}
                      onSelectModel={(modelId) => updateModel.mutate(modelId)}
                    />
                  )
                ) : (
                  <div className="flex items-center justify-center h-full text-[13px] text-text-muted">
                    {t("models.selectProvider")}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Managed provider detail (Nexu Official) ───────────────────

function ManagedProviderDetail({
  provider,
  currentModelId,
  onSelectModel,
}: {
  provider: ProviderConfig;
  currentModelId: string;
  onSelectModel: (modelId: string) => void;
}) {
  const { t } = useTranslation();

  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [cloudDisconnecting, setCloudDisconnecting] = useState(false);
  const queryClient = useQueryClient();
  const { data: desktopCloudStatus, refetch: refetchDesktopCloudStatus } =
    useDesktopCloudStatus();
  const cloudConnected = desktopCloudStatus?.connected ?? false;
  const refreshCloudModels = useMutation({
    mutationFn: async () => {
      await postApiInternalDesktopCloudRefresh();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-default-model"] });
      toast.success(t("models.managed.refreshSucceeded"));
    },
    onError: () => {
      toast.error(t("models.managed.refreshFailed"));
    },
  });

  // Poll cloud-status while waiting for browser login
  useEffect(() => {
    if (!loginBusy) return;
    const interval = setInterval(async () => {
      try {
        const result = await refetchDesktopCloudStatus();
        if (result.data?.connected) {
          setLoginBusy(false);
          await syncDesktopCloudQueries(queryClient);
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [loginBusy, queryClient, refetchDesktopCloudStatus]);

  const handleLogin = async () => {
    setLoginBusy(true);
    setLoginError(null);
    try {
      let { data } = await postApiInternalDesktopCloudConnect();
      // If a stale polling session exists, disconnect and retry once. Keep the
      // current flow when another tab/process is already waiting for completion.
      if (
        data?.error &&
        data.error !== "Connection attempt already in progress" &&
        data.error !== "Already connected. Disconnect first."
      ) {
        await postApiInternalDesktopCloudDisconnect().catch(() => {});
        ({ data } = await postApiInternalDesktopCloudConnect());
      }
      if (data?.error === "Already connected. Disconnect first.") {
        await syncDesktopCloudQueries(queryClient);
        setLoginBusy(false);
        return;
      }
      // Another surface/process already kicked off login — treat as pending and
      // let the polling effect detect completion instead of dropping the user
      // into an error state.
      if (data?.error === "Connection attempt already in progress") {
        return;
      }
      if (data?.error) {
        setLoginError(data.error ?? t("welcome.connectFailed"));
        setLoginBusy(false);
        return;
      }
      if (data?.browserUrl) {
        window.open(data.browserUrl, "_blank", "noopener,noreferrer");
      }
      // Keep loginBusy=true — polling effect will detect completion.
    } catch {
      setLoginError(t("welcome.cloudConnectError"));
      setLoginBusy(false);
    }
  };

  const handleCancelLogin = async () => {
    try {
      await postApiInternalDesktopCloudDisconnect();
      await syncDesktopCloudQueries(queryClient);
    } catch {
      // ignore
    }
    setLoginBusy(false);
    setLoginError(null);
  };

  const cloudToggleBusy = loginBusy || cloudDisconnecting;

  return (
    <div>
      {/* Header + cloud connection text action */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-2 shrink-0">
            <ProviderLogo provider={provider.id} size={20} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text-primary">
              {provider.name}
            </div>
            <div className="text-[11px] text-text-tertiary">
              {t(provider.description)}
            </div>
          </div>
        </div>
        {(cloudConnected || loginBusy) && (
          <button
            type="button"
            disabled={cloudToggleBusy}
            aria-busy={cloudToggleBusy}
            aria-label={
              cloudConnected
                ? t("models.managed.cloudDisconnectAria")
                : t("models.managed.cloudConnectAria")
            }
            onClick={async () => {
              if (cloudConnected) {
                if (cloudDisconnecting) return;
                setCloudDisconnecting(true);
                try {
                  await postApiInternalDesktopCloudDisconnect().catch(() => {});
                  await syncDesktopCloudQueries(queryClient);
                } finally {
                  setCloudDisconnecting(false);
                }
              }
            }}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0 rounded-lg border border-border px-2.5 py-1 transition-colors cursor-pointer text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {(cloudDisconnecting || loginBusy) && (
              <Loader2 size={12} className="animate-spin shrink-0" />
            )}
            <span className="truncate">
              {loginBusy
                ? t("models.managed.waitingLogin")
                : t("models.managed.connected")}
            </span>
          </button>
        )}
      </div>

      {/* Login prompt */}
      {!cloudConnected && (
        <div className="rounded-xl border border-[var(--color-brand-primary)]/25 bg-[var(--color-brand-subtle)] px-4 py-4 mb-6">
          <div className="text-[13px] font-semibold text-[var(--color-brand-primary)]">
            {t("models.managed.loginPrompt")}
          </div>
          <div className="text-[12px] leading-[1.7] text-text-secondary mt-1.5">
            {t("models.managed.loginDescription")}
          </div>
          {loginBusy ? (
            <div className="mt-4 flex items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-lg bg-accent/80 px-3.5 py-2 text-[12px] font-medium text-white">
                <Loader2 size={13} className="animate-spin" />
                {t("models.managed.waitingLogin")}
              </div>
              <button
                type="button"
                onClick={() => void handleCancelLogin()}
                className="text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleLogin()}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-fg transition-colors hover:bg-accent/90 cursor-pointer"
            >
              {t("models.managed.loginButton")}
              <ArrowUpRight size={13} />
            </button>
          )}
          {loginError && (
            <p className="mt-2 text-[11px] text-red-500">{loginError}</p>
          )}
        </div>
      )}

      {/* Cloud models — clickable to switch active model */}
      {provider.models.length > 0 && (
        <div className="mb-6 pt-5 border-t border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
              {t("models.managed.availableModels")}
              <span className="ml-1.5 normal-case tracking-normal">
                ({provider.models.length})
              </span>
            </div>
            {cloudConnected && (
              <button
                type="button"
                onClick={() => {
                  refreshCloudModels.mutate();
                }}
                disabled={refreshCloudModels.isPending}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              >
                <RefreshCw
                  size={10}
                  className={cn(refreshCloudModels.isPending && "animate-spin")}
                />
                {t("models.managed.refreshModelList")}
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {provider.models.map((model) => {
              const isSelected = isModelSelected(model.id, currentModelId);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    if (!isSelected) onSelectModel(model.id);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                    isSelected ? "bg-surface-2" : "hover:bg-surface-2",
                  )}
                >
                  <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-white border border-border-subtle">
                    <ModelLogo
                      model={model.id}
                      provider={provider.id}
                      size={14}
                    />
                  </span>
                  <span
                    className={cn(
                      "flex-1 text-[12px] truncate",
                      isSelected
                        ? "font-semibold text-text-primary"
                        : "font-medium text-text-primary",
                    )}
                  >
                    {model.name}
                  </span>
                  {isSelected && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-text-secondary shrink-0">
                      <Check size={12} />
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── BYOK provider detail panel ────────────────────────────────

function ByokProviderDetail({
  provider,
  providerKey,
  providerConfig,
  onSaveProviderConfig,
  onDeleteProviderConfig,
  queryClient,
  currentModelId,
  onAutoSelectModel,
  onSelectModel,
}: {
  provider: ByokProviderEntry;
  providerKey: string;
  providerConfig?: StoredProviderConfig;
  onSaveProviderConfig: (
    provider: ByokProviderEntry,
    config: StoredProviderConfig,
  ) => Promise<void>;
  onDeleteProviderConfig: (provider: ByokProviderEntry) => Promise<void>;
  queryClient: ReturnType<typeof useQueryClient>;
  currentModelId: string;
  onAutoSelectModel: (modelId: string) => void;
  onSelectModel: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const providerId = provider.id;
  const providerDisplayName = getProviderDisplayName(provider, t);
  const providerDescriptionKey = provider.descriptionKey;
  const providerApiDocsUrl = provider.apiDocsUrl;
  const providerApiKeyPlaceholder =
    provider.apiKeyPlaceholder ?? "your-api-key";
  const providerDefaultProxyUrl = getProviderDefaultBaseUrl(provider);

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    providerConfig?.baseUrl ?? getProviderDefaultBaseUrl(provider),
  );
  const [authMode, setAuthMode] = useState<"apiKey" | "oauth">(
    getDefaultMiniMaxAuthMode(provider, providerConfig),
  );
  const [oauthRegion, setOauthRegion] = useState<"global" | "cn">(
    providerConfig?.oauthRegion ?? "global",
  );
  const [dismissedMiniMaxOauthError, setDismissedMiniMaxOauthError] = useState<
    string | null
  >(null);
  const [isEditingApiKey, setIsEditingApiKey] = useState(
    !providerConfig?.apiKey,
  );
  const isMiniMax = providerId === "minimax";
  const isOllama = providerId === "ollama";
  const isAwsSdkProvider = provider.authModes.includes("aws-sdk");
  const hostBridge = getModelsHostInvokeBridge();
  const effectiveApiKey = isOllama ? OLLAMA_DUMMY_API_KEY : apiKey.trim();

  const { data: minimaxOauthStatus } = useQuery({
    queryKey: ["minimax-oauth-status"],
    enabled: isMiniMax,
    queryFn: async () => {
      if (hostBridge) {
        return hostBridge.invoke("desktop:get-minimax-oauth-status", undefined);
      }
      const { data } = await getApiV1ModelProvidersMinimaxOauthStatus();
      return data;
    },
    refetchInterval: (query) => (query.state.data?.inProgress ? 2000 : false),
  });

  const hasMiniMaxOauthAccess =
    isMiniMax &&
    (minimaxOauthStatus?.connected === true || providerConfig?.oauthProfileRef);
  const hasSavedAwsSdkAccess =
    isAwsSdkProvider && providerConfig?.auth === "aws-sdk";
  const hasSavedApiKey = Boolean(providerConfig?.apiKey);
  const hasSavedAccess = Boolean(
    hasSavedApiKey || hasMiniMaxOauthAccess || hasSavedAwsSdkAccess,
  );

  const visibleMiniMaxOauthError =
    minimaxOauthStatus?.error &&
    minimaxOauthStatus.error !== dismissedMiniMaxOauthError
      ? minimaxOauthStatus.error
      : null;

  // Available models from verification
  const [verifiedModels, setVerifiedModels] = useState<string[] | null>(null);

  // ── OAuth state (OpenAI only) ──────────────────────────
  const isOAuthProvider = providerId === "openai";
  const [oauthPending, setOauthPending] = useState(false);

  const oauthProviderStatus = useQuery({
    queryKey: ["oauth-provider-status", providerId],
    queryFn: async () => {
      const res = await getApiV1ModelProvidersByProviderIdOauthProviderStatus({
        path: { providerId },
      });
      return res.data ?? { connected: false };
    },
    enabled: isOAuthProvider,
    refetchInterval: false,
  });

  const oauthFlowStatus = useQuery({
    queryKey: ["oauth-flow-status", providerId],
    queryFn: async () => {
      const res = await getApiV1ModelProvidersByProviderIdOauthStatus({
        path: { providerId },
      });
      return res.data ?? { status: "idle" as const };
    },
    enabled: isOAuthProvider && oauthPending,
    refetchInterval: oauthPending ? 2000 : false,
  });

  // React to flow status changes
  const flowDataStatus = oauthFlowStatus.data?.status;
  const flowDataError = oauthFlowStatus.data?.error;
  useEffect(() => {
    if (!oauthPending) return;
    if (flowDataStatus === "completed") {
      setOauthPending(false);
      queryClient.invalidateQueries({ queryKey: ["oauth-provider-status"] });
      queryClient.invalidateQueries({ queryKey: ["model-provider-config"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-default-model"] });
      toast.success(t("models.byok.oauthSuccess"));
      markSetupComplete();
    } else if (flowDataStatus === "failed") {
      setOauthPending(false);
      toast.error(flowDataError ?? t("models.byok.oauthFailed"));
    }
  }, [flowDataStatus, flowDataError, oauthPending, queryClient, t]);

  const startOAuthMutation = useMutation({
    mutationFn: async () => {
      const res = await postApiV1ModelProvidersByProviderIdOauthStart({
        path: { providerId },
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.browserUrl) {
        window.open(data.browserUrl, "_blank");
        setOauthPending(true);
      } else if (data?.error) {
        toast.error(data.error);
      }
    },
  });

  const disconnectOAuthMutation = useMutation({
    mutationFn: async () => {
      const res = await postApiV1ModelProvidersByProviderIdOauthDisconnect({
        path: { providerId },
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["oauth-provider-status"] });
      queryClient.invalidateQueries({ queryKey: ["model-provider-config"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-default-model"] });
    },
  });

  const isOAuthConnected =
    isOAuthProvider && oauthProviderStatus.data?.connected === true;
  const canSubmitApiKeyConfig = Boolean(
    isOllama ||
      isAwsSdkProvider ||
      effectiveApiKey ||
      (!isEditingApiKey && hasSavedApiKey),
  );
  const canRefreshModels = Boolean(
    isOllama || isAwsSdkProvider || effectiveApiKey || hasSavedApiKey,
  );
  const isProviderConfigured = Boolean(
    isOllama || hasSavedAccess || isOAuthConnected,
  );
  const storedModelIds = useMemo(
    () => providerConfig?.models?.map((model) => model.id) ?? [],
    [providerConfig?.models],
  );
  const persistedApiKey =
    effectiveApiKey || (!isEditingApiKey ? providerConfig?.apiKey : undefined);
  const validationApiKey =
    typeof persistedApiKey === "string" ? persistedApiKey : undefined;

  const buildProviderConfig = useCallback(
    (modelIds: string[]): StoredProviderConfig => ({
      ...(providerConfig?.providerTemplateId
        ? { providerTemplateId: providerConfig.providerTemplateId }
        : {}),
      ...(providerConfig?.instanceId
        ? { instanceId: providerConfig.instanceId }
        : {}),
      enabled: true,
      auth: isAwsSdkProvider ? "aws-sdk" : "api-key",
      api: provider.apiKind,
      ...(!isAwsSdkProvider && persistedApiKey
        ? { apiKey: persistedApiKey }
        : {}),
      baseUrl: baseUrl || getProviderDefaultBaseUrl(provider),
      ...(isMiniMax ? { oauthRegion } : {}),
      displayName:
        providerConfig?.providerTemplateId && providerConfig.displayName?.trim()
          ? providerConfig.displayName
          : providerDisplayName,
      ...(providerConfig?.headers ? { headers: providerConfig.headers } : {}),
      ...(providerConfig?.metadata
        ? { metadata: providerConfig.metadata }
        : {}),
      models: buildStoredModels(provider, modelIds),
    }),
    [
      baseUrl,
      isMiniMax,
      oauthRegion,
      persistedApiKey,
      provider,
      providerDisplayName,
      providerConfig?.headers,
      providerConfig?.displayName,
      providerConfig?.instanceId,
      isAwsSdkProvider,
      providerConfig?.providerTemplateId,
      providerConfig?.metadata,
    ],
  );

  // ── Z.AI Coding Plan state ───────────────────────────
  const isZaiProvider = providerId === "zai";
  const [codingPlanKey, setCodingPlanKey] = useState("");
  const [codingPlanRegion, setCodingPlanRegion] = useState<"global" | "cn">(
    "global",
  );
  const codingPlanBaseUrl: string =
    codingPlanRegion === "cn"
      ? "https://open.bigmodel.cn/api/coding/paas/v4"
      : "https://api.z.ai/api/coding/paas/v4";

  const saveCodingPlanMutation = useMutation({
    mutationFn: () =>
      onSaveProviderConfig(provider, {
        ...(providerConfig?.providerTemplateId
          ? { providerTemplateId: providerConfig.providerTemplateId }
          : {}),
        ...(providerConfig?.instanceId
          ? { instanceId: providerConfig.instanceId }
          : {}),
        enabled: true,
        auth: "api-key",
        api: provider.apiKind,
        apiKey: codingPlanKey,
        baseUrl: codingPlanBaseUrl,
        ...(providerConfig?.headers ? { headers: providerConfig.headers } : {}),
        ...(providerConfig?.metadata
          ? { metadata: providerConfig.metadata }
          : {}),
        displayName: "Zhipu",
        models: buildStoredModels(provider, ZAI_CODING_PLAN_MODELS),
      }),
    onSuccess: () => {
      setCodingPlanKey("");
      markSetupComplete();
      const preferred = selectPreferredModel(ZAI_CODING_PLAN_MODELS);
      if (preferred) {
        onAutoSelectModel(preferred);
      }
    },
  });

  // Reset form when provider changes
  useEffect(() => {
    setApiKey("");
    setBaseUrl(providerConfig?.baseUrl ?? getProviderDefaultBaseUrl(provider));
    setAuthMode(getDefaultMiniMaxAuthMode(provider, providerConfig));
    setOauthRegion(providerConfig?.oauthRegion ?? "global");
    setIsEditingApiKey(!providerConfig?.apiKey);
    setVerifiedModels(null);
    setOauthPending(false);
    setCodingPlanKey("");
    setCodingPlanRegion("global");
  }, [provider, providerConfig]);

  useEffect(() => {
    if (!isMiniMax) {
      return;
    }

    if (authMode !== "oauth") {
      setVerifiedModels(null);
      return;
    }

    setVerifiedModels(storedModelIds.length > 0 ? storedModelIds : null);
  }, [authMode, isMiniMax, storedModelIds]);

  // ── Verify mutation ──────────────────────────────────
  const verifyMutation = useMutation({
    mutationFn: () =>
      verifyApiKey(
        providerKey,
        providerId,
        validationApiKey,
        baseUrl || undefined,
      ),
    onSuccess: (result) => {
      track("workspace_provider_check", {
        provider_name: providerId,
        success: result.valid,
      });
      const modelIds = normalizeVerifiedModelIds(result.models);
      if (result.valid) {
        setVerifiedModels(modelIds);
      }
    },
    onError: () => {
      track("workspace_provider_check", {
        provider_name: providerId,
        success: false,
      });
    },
  });

  const refreshModelsMutation = useMutation({
    mutationFn: async () => {
      const result = await verifyApiKey(
        providerKey,
        providerId,
        validationApiKey,
        baseUrl || undefined,
      );

      if (!result.valid) {
        throw new Error(result.error ?? t("models.byok.keyInvalidUnknown"));
      }

      const models = normalizeVerifiedModelIds(result.models);
      setVerifiedModels(models);

      if (hasSavedAccess || isOllama) {
        await onSaveProviderConfig(provider, buildProviderConfig(models));
      }

      return models;
    },
    onSuccess: (models) => {
      toast.success(t("models.byok.refreshSuccess", { count: models.length }));
    },
    onError: (error) => {
      toast.error(error.message || t("models.byok.refreshFailed"));
    },
  });

  // ── Save mutation ────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      let models = displayModels;
      if (isOllama || isAwsSdkProvider || effectiveApiKey || hasSavedApiKey) {
        const result = await verifyApiKey(
          providerKey,
          providerId,
          validationApiKey,
          baseUrl || undefined,
        );
        if (result.valid && result.models) {
          models = normalizeVerifiedModelIds(result.models);
          setVerifiedModels(models);
        }
      }

      await onSaveProviderConfig(provider, buildProviderConfig(models));

      return { models };
    },
    onSuccess: ({ models }) => {
      track("workspace_provider_save", {
        provider_name: providerId,
      });
      setApiKey("");
      setIsEditingApiKey(false);
      markSetupComplete();
      // Auto-select preferred model if no model is currently selected
      const preferred = selectPreferredModel(models);
      if (preferred) {
        onAutoSelectModel(getScopedByokModelId(preferred));
      }
    },
  });

  const resetProviderActionState = useCallback(() => {
    verifyMutation.reset();
    saveMutation.reset();
  }, [saveMutation, verifyMutation]);

  // ── Delete mutation ──────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => onDeleteProviderConfig(provider),
    onSuccess: () => {
      if (isMiniMax) {
        queryClient.setQueryData(["minimax-oauth-status"], {
          connected: false,
          inProgress: false,
          region: oauthRegion,
          error: null,
        });
        queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
      }
      setApiKey("");
      setBaseUrl(getProviderDefaultBaseUrl(provider));
      setIsEditingApiKey(true);
      setVerifiedModels(null);
    },
  });

  const minimaxOauthMutation = useMutation({
    mutationFn: async () => {
      if (hostBridge) {
        return hostBridge.invoke("desktop:start-minimax-oauth", {
          region: oauthRegion,
        });
      }
      const { data, error } = await postApiV1ModelProvidersMinimaxOauthLogin({
        body: { region: oauthRegion },
      });
      if (error || !data) {
        throw new Error("Failed to start MiniMax OAuth login");
      }
      return data;
    },
    onSuccess: async (result) => {
      const browserUrl =
        "browserUrl" in result && typeof result.browserUrl === "string"
          ? result.browserUrl
          : null;
      if (browserUrl) {
        await openExternalUrl(browserUrl);
      }
      queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
      setMiniMaxOauthErrorInCache(
        queryClient,
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  });

  const cancelMiniMaxOauthMutation = useMutation({
    mutationFn: async () => {
      if (hostBridge) {
        return hostBridge.invoke("desktop:cancel-minimax-oauth", undefined);
      }
      const { data, error } =
        await deleteApiV1ModelProvidersMinimaxOauthLogin();
      if (error || !data) {
        throw new Error("Failed to cancel MiniMax OAuth login");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
      setMiniMaxOauthErrorInCache(
        queryClient,
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  });

  useEffect(() => {
    if (!isMiniMax || !minimaxOauthStatus?.connected) {
      return;
    }

    const syncOauthModels = async () => {
      const config = await queryClient.fetchQuery({
        queryKey: ["model-provider-config"],
        queryFn: fetchModelProviderConfig,
      });
      const providerModels =
        getProviderConfigMatch(config, "minimax")?.config.models?.map(
          (model) => model.id,
        ) ?? [];
      if (providerModels.length > 0) {
        setVerifiedModels(providerModels);
      }

      await queryClient.refetchQueries({ queryKey: ["models"] });
      await queryClient.refetchQueries({ queryKey: ["desktop-default-model"] });
    };

    void syncOauthModels();
  }, [isMiniMax, minimaxOauthStatus?.connected, queryClient]);

  // Model list to show: verified > DB stored > defaults
  const displayModels = useMemo(() => {
    if (verifiedModels && verifiedModels.length > 0) return verifiedModels;
    if (storedModelIds.length > 0) return storedModelIds;
    return [];
  }, [storedModelIds, verifiedModels]);

  const getScopedByokModelId = useCallback(
    (modelId: string) =>
      modelId.startsWith(`${providerKey}/`)
        ? modelId
        : `${providerKey}/${modelId}`,
    [providerKey],
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-2 shrink-0">
            <ProviderLogo provider={providerId} size={20} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-[14px] font-semibold text-text-primary">
                {providerDisplayName}
              </div>
              {providerApiDocsUrl && (
                <a
                  href={providerApiDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link text-[11px]"
                >
                  {t("models.byok.getApiKey")}
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
            <div className="text-[11px] text-text-tertiary">
              {providerDescriptionKey ? t(providerDescriptionKey) : ""}
            </div>
          </div>
        </div>
      </div>

      {/* OAuth section (OpenAI only) */}
      {isOAuthProvider && (
        <div className="mb-6">
          {isOAuthConnected ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
                  {t("models.byok.oauthConnected")}
                </div>
                <div className="text-[10px] text-emerald-600/70 dark:text-emerald-500/70">
                  {t("models.byok.oauthDescription")}
                </div>
              </div>
              <button
                type="button"
                disabled={disconnectOAuthMutation.isPending}
                onClick={() => {
                  if (confirm(t("models.byok.confirmRemove"))) {
                    disconnectOAuthMutation.mutate();
                  }
                }}
                className="shrink-0 rounded-lg border border-border px-3 py-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-2"
              >
                {disconnectOAuthMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  t("models.byok.oauthDisconnect")
                )}
              </button>
            </div>
          ) : oauthPending ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-1 px-3 py-3">
              <Loader2 size={14} className="animate-spin text-text-muted" />
              <span className="text-[12px] text-text-secondary">
                {t("models.byok.oauthPending")}
              </span>
            </div>
          ) : (
            <button
              type="button"
              disabled={startOAuthMutation.isPending}
              onClick={() => startOAuthMutation.mutate()}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-0 px-4 py-2.5 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2"
            >
              {startOAuthMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <LogIn size={14} />
              )}
              {t("models.byok.oauthLoginChatGPT")}
            </button>
          )}

          {!isOAuthConnected && (
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 border-t border-border" />
              <span className="text-[10px] text-text-muted">
                {t("models.byok.oauthOrApiKey")}
              </span>
              <div className="flex-1 border-t border-border" />
            </div>
          )}
        </div>
      )}

      {isMiniMax && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-surface-0 p-1">
          <button
            type="button"
            onClick={() => setAuthMode("oauth")}
            className={cn(
              "rounded-md px-3 py-2 text-[12px] font-medium transition-colors",
              authMode === "oauth"
                ? "bg-accent text-accent-fg"
                : "text-text-secondary hover:bg-surface-2",
            )}
          >
            {t("models.byok.minimax.authModeOauth")}
          </button>
          <button
            type="button"
            onClick={() => setAuthMode("apiKey")}
            className={cn(
              "rounded-md px-3 py-2 text-[12px] font-medium transition-colors",
              authMode === "apiKey"
                ? "bg-accent text-accent-fg"
                : "text-text-secondary hover:bg-surface-2",
            )}
          >
            {t("models.byok.minimax.authModeApiKey")}
          </button>
        </div>
      )}

      {isMiniMax && authMode === "oauth" ? (
        <div className="space-y-4 mb-6">
          <div className="rounded-xl border border-border bg-surface-0 p-4">
            <div className="mb-3 text-[12px] font-medium text-text-primary">
              {t("models.byok.minimax.oauthTitle")}
            </div>
            <div className="mb-4 text-[11px] leading-6 text-text-secondary">
              {t("models.byok.minimax.oauthDescription")}
            </div>
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOauthRegion("global")}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  oauthRegion === "global"
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-text-secondary hover:bg-surface-2",
                )}
              >
                {t("models.byok.minimax.regionGlobal")}
              </button>
              <button
                type="button"
                onClick={() => setOauthRegion("cn")}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  oauthRegion === "cn"
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-text-secondary hover:bg-surface-2",
                )}
              >
                {t("models.byok.minimax.regionCn")}
              </button>
            </div>
            <div className="mb-4 text-[10px] text-text-muted">
              {t("models.byok.minimax.endpoint", {
                endpoint:
                  oauthRegion === "cn" ? "api.minimaxi.com" : "api.minimax.io",
              })}
            </div>
            {minimaxOauthStatus?.connected ||
            providerConfig?.oauthProfileRef ? (
              <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700">
                {t("models.byok.minimax.connected")}
              </div>
            ) : null}
            {visibleMiniMaxOauthError ? (
              <div className="mb-4 flex items-start justify-between gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-600">
                <div className="min-w-0 flex-1">{visibleMiniMaxOauthError}</div>
                <button
                  type="button"
                  onClick={() =>
                    setDismissedMiniMaxOauthError(visibleMiniMaxOauthError)
                  }
                  className="rounded p-0.5 text-red-500/80 transition-colors hover:bg-red-500/10 hover:text-red-600"
                  aria-label={t("models.byok.minimax.dismissError")}
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              {minimaxOauthStatus?.inProgress ? (
                <>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-accent-fg opacity-80"
                  >
                    <Loader2 size={13} className="animate-spin" />
                    {t("models.byok.minimax.waitingLogin")}
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelMiniMaxOauthMutation.mutate()}
                    className="rounded-lg px-3 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-2"
                  >
                    {t("models.byok.minimax.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => minimaxOauthMutation.mutate()}
                    disabled={minimaxOauthMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-60"
                  >
                    {minimaxOauthMutation.isPending && (
                      <Loader2 size={13} className="animate-spin" />
                    )}
                    {!minimaxOauthMutation.isPending &&
                      (hasMiniMaxOauthAccess ? (
                        <RefreshCw size={13} />
                      ) : (
                        <LogIn size={13} />
                      ))}
                    {hasMiniMaxOauthAccess
                      ? t("models.byok.minimax.reconnect")
                      : t("models.byok.minimax.login")}
                  </button>
                  {hasSavedAccess && (
                    <button
                      type="button"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (confirm(t("models.byok.confirmRemove"))) {
                          deleteMutation.mutate();
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/5"
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      {t("models.byok.remove")}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Z.AI Coding Plan section (GLM only) */}
      {isZaiProvider && (
        <div className="mb-6">
          <div className="rounded-lg border border-border bg-surface-0 p-4">
            <div className="text-[12px] font-medium text-text-primary mb-1">
              {t("models.byok.zaiCodingPlan")}
            </div>
            <div className="text-[10px] text-text-muted mb-3">
              {t("models.byok.zaiCodingPlanDesc")}
            </div>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setCodingPlanRegion("global")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                  codingPlanRegion === "global"
                    ? "bg-accent text-accent-fg"
                    : "bg-surface-2 text-text-secondary hover:bg-surface-3",
                )}
              >
                Global
              </button>
              <button
                type="button"
                onClick={() => setCodingPlanRegion("cn")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                  codingPlanRegion === "cn"
                    ? "bg-accent text-accent-fg"
                    : "bg-surface-2 text-text-secondary hover:bg-surface-3",
                )}
              >
                CN
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={codingPlanKey}
                onChange={(e) => setCodingPlanKey(e.target.value)}
                placeholder="sk-..."
                className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20 focus:border-[var(--color-brand-primary)]/30"
              />
              <button
                type="button"
                disabled={!codingPlanKey || saveCodingPlanMutation.isPending}
                onClick={() => saveCodingPlanMutation.mutate()}
                className={cn(
                  "px-4 py-2 rounded-lg text-[12px] font-medium transition-colors",
                  codingPlanKey
                    ? "bg-accent text-accent-fg hover:bg-accent/90"
                    : "bg-surface-2 text-text-muted cursor-not-allowed",
                )}
              >
                {saveCodingPlanMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  t("models.byok.saveAndEnable")
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 border-t border-border" />
            <span className="text-[10px] text-text-muted">
              {t("models.byok.zaiOrGeneralApi")}
            </span>
            <div className="flex-1 border-t border-border" />
          </div>
        </div>
      )}

      {!isOAuthConnected && (!isMiniMax || authMode === "apiKey") && (
        <div className="space-y-4 mb-6">
          {!isOllama && !isAwsSdkProvider && (
            <div>
              <label
                htmlFor={`apikey-${providerId}`}
                className="block text-[12px] font-medium text-text-secondary mb-1.5"
              >
                {t("models.byok.apiKey")}
              </label>
              {hasSavedApiKey && !isEditingApiKey ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-brand-primary)]/25 bg-[var(--color-brand-subtle)] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-text-primary">
                      {t("models.byok.apiKeySaved")}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {t("models.byok.apiKeySavedHint")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingApiKey(true)}
                    className="shrink-0 rounded-lg border border-border px-3 py-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-2"
                  >
                    {t("models.byok.changeApiKey")}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    id={`apikey-${providerId}`}
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      resetProviderActionState();
                      setApiKey(e.target.value);
                    }}
                    placeholder={providerApiKeyPlaceholder}
                    className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20 focus:border-[var(--color-brand-primary)]/30"
                  />
                  <button
                    type="button"
                    disabled={!apiKey || verifyMutation.isPending}
                    onClick={() => verifyMutation.mutate()}
                    className={cn(
                      "px-3 py-2 rounded-lg border border-border text-[11px] font-medium transition-colors",
                      apiKey
                        ? "text-text-secondary hover:bg-surface-2"
                        : "text-text-muted cursor-not-allowed",
                    )}
                  >
                    {verifyMutation.isPending ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : verifyMutation.isSuccess &&
                      verifyMutation.data?.valid ? (
                      <Check size={12} className="text-emerald-600" />
                    ) : (
                      t("models.byok.verify")
                    )}
                  </button>
                </div>
              )}
              {verifyMutation.isSuccess && (
                <div
                  className={cn(
                    "mt-1.5 text-[10px]",
                    verifyMutation.data?.valid
                      ? "text-emerald-600"
                      : "text-red-500",
                  )}
                >
                  {verifyMutation.data?.valid
                    ? t("models.byok.keyValid", {
                        count: verifyMutation.data.models?.length ?? 0,
                      })
                    : t("models.byok.keyInvalid", {
                        error:
                          verifyMutation.data?.error ??
                          t("models.byok.keyInvalidUnknown"),
                      })}
                </div>
              )}
            </div>
          )}
          {isAwsSdkProvider && (
            <div className="rounded-lg border border-border bg-surface-0 px-3 py-2.5">
              <div className="text-[12px] font-medium text-text-primary">
                {t("models.byok.awsSdkAuth")}
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                {t("models.byok.awsSdkAuthHint")}
              </div>
            </div>
          )}
          <div>
            <label
              htmlFor={`baseurl-${providerId}`}
              className="block text-[12px] font-medium text-text-secondary mb-1.5"
            >
              {t("models.byok.proxyUrl")}
            </label>
            {isMiniMax && (
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBaseUrl("https://api.minimax.io/anthropic")}
                  className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface-2"
                >
                  {t("models.byok.minimax.regionGlobal")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setBaseUrl("https://api.minimaxi.com/anthropic")
                  }
                  className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface-2"
                >
                  {t("models.byok.minimax.regionCn")}
                </button>
              </div>
            )}
            <input
              id={`baseurl-${providerId}`}
              type="text"
              value={baseUrl}
              onChange={(e) => {
                resetProviderActionState();
                setBaseUrl(e.target.value);
              }}
              placeholder={
                providerDefaultProxyUrl || "https://api.example.com/v1"
              }
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20 focus:border-[var(--color-brand-primary)]/30"
            />
            {isOllama && verifyMutation.isSuccess && (
              <div
                className={cn(
                  "mt-1.5 text-[10px]",
                  verifyMutation.data?.valid
                    ? "text-emerald-600"
                    : "text-red-500",
                )}
              >
                {verifyMutation.data?.valid
                  ? t("models.byok.keyValid", {
                      count: verifyMutation.data.models?.length ?? 0,
                    })
                  : t("models.byok.keyInvalid", {
                      error:
                        verifyMutation.data?.error ??
                        t("models.byok.keyInvalidUnknown"),
                    })}
              </div>
            )}
          </div>
        </div>
      )}

      {!isOAuthConnected && (
        <div className="flex items-center gap-3 mb-6">
          {(!isMiniMax || authMode === "apiKey") && (
            <button
              type="button"
              disabled={saveMutation.isPending || !canSubmitApiKeyConfig}
              onClick={() => saveMutation.mutate()}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-medium transition-colors",
                !saveMutation.isPending && canSubmitApiKeyConfig
                  ? "bg-accent text-accent-fg hover:bg-accent/90"
                  : "bg-surface-2 text-text-muted cursor-not-allowed",
              )}
            >
              {saveMutation.isPending && (
                <Loader2 size={13} className="animate-spin" />
              )}
              {hasSavedApiKey
                ? t("models.byok.updateConfig")
                : hasSavedAccess
                  ? t("models.byok.updateConfig")
                  : t("models.byok.saveAndEnable")}
            </button>
          )}

          {hasSavedAccess && (!isMiniMax || authMode !== "oauth") && (
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirm(t("models.byok.confirmRemove"))) {
                  deleteMutation.mutate();
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/5"
            >
              {deleteMutation.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Trash2 size={13} />
              )}
              {t("models.byok.remove")}
            </button>
          )}
        </div>
      )}

      {!isOAuthConnected &&
        (!isMiniMax || authMode === "apiKey") &&
        saveMutation.isSuccess && (
          <div className="mb-4 text-[11px] text-[var(--color-success)]">
            {t("models.byok.saveSuccess")}
          </div>
        )}
      {!isOAuthConnected &&
        (!isMiniMax || authMode === "apiKey") &&
        saveMutation.isError && (
          <div className="mb-4 text-[11px] text-red-500">
            {t("models.byok.saveFailed")}
          </div>
        )}

      {/* Model list — clickable to switch active model */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            {t("models.byok.modelList")}
            <span className="ml-1.5 normal-case tracking-normal">
              ({displayModels.length})
            </span>
          </div>
          <button
            type="button"
            disabled={refreshModelsMutation.isPending || !canRefreshModels}
            onClick={() => refreshModelsMutation.mutate()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[10px] font-medium transition-colors",
              !refreshModelsMutation.isPending && canRefreshModels
                ? "text-text-secondary hover:bg-surface-2"
                : "text-text-muted cursor-not-allowed",
            )}
          >
            <RefreshCw
              size={10}
              className={cn(refreshModelsMutation.isPending && "animate-spin")}
            />
            {refreshModelsMutation.isPending
              ? t("models.byok.fetchingModels")
              : t("models.byok.refreshModels")}
          </button>
        </div>
        <div className="space-y-0.5">
          {displayModels.length === 0 && (
            <div className="text-[11px] text-text-muted/60 py-3 text-center">
              {t("models.byok.none")}
            </div>
          )}
          {displayModels.map((modelId) => {
            const scopedModelId = getScopedByokModelId(modelId);
            const isSelected = isByokModelSelected(
              providerKey,
              modelId,
              currentModelId,
            );
            return (
              <button
                key={modelId}
                type="button"
                disabled={!isProviderConfigured}
                onClick={() => {
                  if (!isProviderConfigured || isSelected) return;
                  onSelectModel(scopedModelId);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                  isSelected ? "bg-surface-2" : "hover:bg-surface-2",
                  !isProviderConfigured &&
                    "cursor-not-allowed opacity-60 hover:bg-transparent",
                )}
              >
                <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-white border border-border-subtle">
                  <ModelLogo model={modelId} provider={providerId} size={14} />
                </span>
                <span
                  className={cn(
                    "flex-1 text-[12px] truncate",
                    isSelected
                      ? "font-semibold text-text-primary"
                      : "font-medium text-text-primary",
                  )}
                >
                  {modelId}
                </span>
                {isSelected && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-text-secondary shrink-0">
                    <Check size={12} />
                    Active
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
