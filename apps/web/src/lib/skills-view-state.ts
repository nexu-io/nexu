import type { MinimalSkill, SkillSource } from "@/types/desktop";

export type TopTab = "explore" | "yours";
export type YoursSubTab = "all" | "builtin" | "custom";

export type SkillsViewState = {
  topTab: TopTab;
  yoursSubTab: YoursSubTab;
  activeTag: string | null;
  searchQuery: string;
};

type SkillsHistoryState = {
  idx?: number;
};

type SkillsDetailLocationState = {
  fromSkillsList?: boolean;
  selectedSource?: SkillSource;
  selectedAgentId?: string;
};

type SkillsBackNavigation =
  | { kind: "history"; delta: -1 }
  | { kind: "path"; replace: true; to: string };

const DEFAULT_VIEW_STATE: SkillsViewState = {
  topTab: "yours",
  yoursSubTab: "all",
  activeTag: null,
  searchQuery: "",
};

function isTopTab(value: string | null): value is TopTab {
  return value === "explore" || value === "yours";
}

function isYoursSubTab(value: string | null): value is YoursSubTab {
  return value === "all" || value === "builtin" || value === "custom";
}

function normalizeSearch(search: string): string {
  if (!search) {
    return "";
  }
  return search.startsWith("?") ? search : `?${search}`;
}

function getHistoryIndex(historyState: unknown): number {
  if (
    typeof historyState !== "object" ||
    historyState === null ||
    !("idx" in historyState)
  ) {
    return 0;
  }

  const idx = (historyState as SkillsHistoryState).idx;
  return typeof idx === "number" ? idx : 0;
}

function didNavigateFromSkillsList(locationState: unknown): boolean {
  if (typeof locationState !== "object" || locationState === null) {
    return false;
  }

  return (locationState as SkillsDetailLocationState).fromSkillsList === true;
}

export function parseSkillsViewState(
  searchParams: URLSearchParams,
): SkillsViewState {
  const tabParam = searchParams.get("tab");
  const sourceParam = searchParams.get("source");
  const topTab = isTopTab(tabParam) ? tabParam : DEFAULT_VIEW_STATE.topTab;
  const yoursSubTab = isYoursSubTab(sourceParam)
    ? sourceParam
    : DEFAULT_VIEW_STATE.yoursSubTab;
  const activeTag = searchParams.get("tag")?.trim() || null;
  const searchQuery = searchParams.get("q") ?? DEFAULT_VIEW_STATE.searchQuery;

  return {
    topTab,
    yoursSubTab,
    activeTag,
    searchQuery,
  };
}

export function createSkillsSearchParams(
  state: SkillsViewState,
): URLSearchParams {
  const searchParams = new URLSearchParams();

  if (state.topTab !== DEFAULT_VIEW_STATE.topTab) {
    searchParams.set("tab", state.topTab);
  }
  if (state.yoursSubTab !== DEFAULT_VIEW_STATE.yoursSubTab) {
    searchParams.set("source", state.yoursSubTab);
  }
  if (state.activeTag) {
    searchParams.set("tag", state.activeTag);
  }
  if (state.searchQuery) {
    searchParams.set("q", state.searchQuery);
  }

  return searchParams;
}

export function applySkillsViewStatePatch(
  current: URLSearchParams,
  patch: Partial<SkillsViewState>,
): URLSearchParams {
  const nextState = {
    ...parseSkillsViewState(current),
    ...patch,
  };

  return createSkillsSearchParams(nextState);
}

export type SkillSelection = {
  source?: SkillSource | null;
  agentId?: string | null;
};

export function createSkillDetailPath(
  slug: string,
  search: string,
  selection?: SkillSelection,
): string {
  const searchParams = new URLSearchParams(normalizeSearch(search));
  if (selection?.source) {
    searchParams.set("skillSource", selection.source);
  }
  if (selection?.agentId) {
    searchParams.set("agentId", selection.agentId);
  }

  const query = searchParams.toString();
  return `/workspace/skills/${slug}${query ? `?${query}` : ""}`;
}

export function createSkillDetailState(
  selection?: SkillSelection,
): SkillsDetailLocationState {
  return {
    fromSkillsList: true,
    ...(selection?.source ? { selectedSource: selection.source } : {}),
    ...(selection?.agentId ? { selectedAgentId: selection.agentId } : {}),
  };
}

export function getUnavailableSkillDetailSlugs(
  allSkills: Pick<MinimalSkill, "slug">[],
  activeQueueItems: { slug: string }[],
): Set<string> {
  const catalogSlugs = new Set(allSkills.map((skill) => skill.slug));
  return new Set(
    activeQueueItems
      .filter((queueItem) => !catalogSlugs.has(queueItem.slug))
      .map((queueItem) => queueItem.slug),
  );
}

export function getSkillsBackNavigation(
  historyState: unknown,
  search: string,
  locationState: unknown,
): SkillsBackNavigation {
  if (
    didNavigateFromSkillsList(locationState) &&
    getHistoryIndex(historyState) > 0
  ) {
    return { kind: "history", delta: -1 };
  }

  return {
    kind: "path",
    replace: true,
    to: `/workspace/skills${normalizeSearch(search)}`,
  };
}
