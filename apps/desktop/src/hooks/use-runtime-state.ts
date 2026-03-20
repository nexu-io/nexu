import { useCallback, useEffect, useMemo, useState } from "react";
import type { RuntimeState, RuntimeUnitId } from "../../shared/host";
import { getRuntimeState, onRuntimeEvent } from "../lib/host-api";
import { applyRuntimeEvent } from "../lib/runtime-state";

export function useRuntimeState() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeUnitId, setActiveUnitId] = useState<RuntimeUnitId | null>(null);

  const loadState = useCallback(async () => {
    try {
      const nextState = await getRuntimeState();
      setRuntimeState(nextState);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load runtime state.",
      );
    }
  }, []);

  useEffect(() => {
    void loadState();
    const unsubscribe = onRuntimeEvent((event) => {
      setRuntimeState((current) => {
        if (!current) {
          return current;
        }

        return applyRuntimeEvent(current, event);
      });
      setErrorMessage(null);
    });

    const timer = window.setInterval(() => {
      void loadState();
    }, 15000);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [loadState]);

  const units = runtimeState?.units ?? [];

  useEffect(() => {
    if (units.length === 0) {
      setActiveUnitId(null);
      return;
    }

    if (!activeUnitId || !units.some((unit) => unit.id === activeUnitId)) {
      setActiveUnitId(units[0]?.id ?? null);
    }
  }, [activeUnitId, units]);

  const activeUnit =
    units.find((unit) => unit.id === activeUnitId) ?? units[0] ?? null;

  const summary = useMemo(() => {
    return {
      running: units.filter((unit) => unit.phase === "running").length,
      failed: units.filter((unit) => unit.phase === "failed").length,
      managed: units.filter((unit) => unit.launchStrategy === "managed").length,
    };
  }, [units]);

  return {
    activeUnit,
    errorMessage,
    runtimeState,
    setErrorMessage,
    setRuntimeState,
    summary,
    units,
    loadState,
    setActiveUnitId,
  };
}
