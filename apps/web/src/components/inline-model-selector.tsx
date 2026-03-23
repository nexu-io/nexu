import { track } from "@/lib/tracking";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  getApiInternalDesktopDefaultModel,
  getApiV1Models,
  putApiInternalDesktopDefaultModel,
} from "../../lib/api/sdk.gen";
import { ModelPickerDropdown } from "./model-picker-dropdown";

/**
 * Inline Model Selector for Hero status bar
 *
 * A compact dropdown that shows the current model and allows switching.
 * Reuses the same data flow as the Models page.
 */

interface Model {
  id: string;
  name: string;
  provider: string;
  isDefault?: boolean;
  description?: string;
}

function getProviderIdFromModelId(
  models: Model[],
  modelId: string,
): string | null {
  const matched = models.find((model) => model.id === modelId);
  if (matched) {
    return matched.provider;
  }
  const [provider] = modelId.split("/");
  return provider || null;
}

export function InlineModelSelector() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch current model
  const { data: defaultModelData } = useQuery({
    queryKey: ["desktop-default-model"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopDefaultModel();
      return data as { modelId: string | null } | undefined;
    },
  });

  // Fetch available models
  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data } = await getApiV1Models();
      return data;
    },
  });

  const models = (modelsData?.models ?? []) as Model[];
  const currentModelId = defaultModelData?.modelId ?? "";
  const emptyModelLabel = t("models.noModelConfigured");

  // Update model mutation
  const updateModel = useMutation({
    mutationFn: async (modelId: string) => {
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
      // Config push triggers SIGUSR1 restart; immediately refetch live status
      // so the UI reflects the restart sooner.
      queryClient.invalidateQueries({ queryKey: ["channels-live-status"] });
    },
  });

  return (
    <ModelPickerDropdown
      compact
      models={models}
      currentModelId={currentModelId}
      emptyLabel={emptyModelLabel}
      onSelectModel={(modelId) => updateModel.mutate(modelId)}
      onOpenSettings={() => navigate("/workspace/models?tab=providers")}
    />
  );
}
