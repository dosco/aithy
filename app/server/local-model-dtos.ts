import {
  DEFAULT_LOCAL_AGENT_MODEL,
  MANAGED_LOCAL_CHAT_MODELS,
  REQUIRED_LOCAL_MODELS,
  parseLocalModelId,
  type ManagedLocalModel,
} from "../../src/local-inference/manifest";
import {
  displayModelName,
  listCachedGgufModels,
  managedLocalModelById,
  resolveCachedLocalModelPath,
  type LocalGgufModel,
} from "../../src/local-inference/hf-cache";
import type { LocalModelDto } from "./dto-types";

export async function localModelDtos(cacheDir?: string): Promise<LocalModelDto[]> {
  let cached: LocalGgufModel[] = [];
  try {
    cached = await listCachedGgufModels(cacheDir);
  } catch {
    cached = [];
  }
  const cachedDtos = cached.map(localModelDto);
  const cachedById = new Map(cachedDtos.map((model) => [model.id, model]));
  const managedChat = MANAGED_LOCAL_CHAT_MODELS.map((model) =>
    cachedById.get(model.id) ?? managedLocalModelDto(model, false)
  );
  const managedChatIds = new Set(MANAGED_LOCAL_CHAT_MODELS.map((model) => model.id));
  const rest = cachedDtos
    .filter((model) => !managedChatIds.has(model.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return [...managedChat, ...rest];
}

export function defaultLocalModelDto(cached: boolean): LocalModelDto {
  return managedLocalModelDto(DEFAULT_LOCAL_AGENT_MODEL, cached);
}

export async function coreLocalModelDtos(
  selectedChatModelId: string,
  localModels: readonly LocalModelDto[],
): Promise<LocalModelDto[]> {
  const selected = localModels.find((model) => model.id === selectedChatModelId)
    ?? await localModelDtoForId(selectedChatModelId);
  const chatModel = { ...selected, role: "chat" };
  const core = await Promise.all(REQUIRED_LOCAL_MODELS.map(async (model) => {
    const cachedPath = await resolveCachedLocalModelPath(model.id).catch(() => null);
    return managedLocalModelDto(model, Boolean(cachedPath), cachedPath ?? "");
  }));
  return [chatModel, ...core];
}

function localModelDto(model: LocalGgufModel): LocalModelDto {
  const managed = managedLocalModelById(model.id);
  return {
    id: model.id,
    repoId: model.repoId,
    filename: model.filename,
    displayName: managed?.label ?? model.displayName,
    alias: managed?.alias,
    role: managed?.role,
    path: model.path,
    sizeBytes: model.sizeBytes,
    managed: model.managed,
    cached: true,
  };
}

async function localModelDtoForId(id: string): Promise<LocalModelDto> {
  const managed = managedLocalModelById(id);
  if (managed) {
    const cachedPath = await resolveCachedLocalModelPath(id).catch(() => null);
    return managedLocalModelDto(managed, Boolean(cachedPath), cachedPath ?? "");
  }
  const parsed = parseLocalModelId(id);
  if (!parsed) return defaultLocalModelDto(false);
  const cachedPath = await resolveCachedLocalModelPath(id).catch(() => null);
  return {
    id,
    repoId: parsed.repoId,
    filename: parsed.filename,
    displayName: displayModelName(parsed.repoId, parsed.filename),
    path: cachedPath ?? "",
    sizeBytes: 0,
    managed: false,
    cached: Boolean(cachedPath),
  };
}

function managedLocalModelDto(
  model: ManagedLocalModel,
  cached: boolean,
  path = "",
): LocalModelDto {
  return {
    id: model.id,
    repoId: model.repoId,
    filename: model.filename,
    displayName: model.label,
    alias: model.alias,
    role: model.role,
    path,
    sizeBytes: 0,
    managed: true,
    cached,
  };
}
