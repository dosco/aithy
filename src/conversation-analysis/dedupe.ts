export interface DedupeSearchInput<TItem> {
  item: TItem;
  index: number;
}

export interface DedupeDecisionInput<TItem, TMatch> extends DedupeSearchInput<TItem> {
  matches: readonly TMatch[];
}

export interface DuplicateExtraction<TItem, TMatch> {
  item: TItem;
  index: number;
  matches: readonly TMatch[];
}

export interface DedupeExtractedItemsOptions<TItem, TMatch> {
  search: (input: DedupeSearchInput<TItem>) => MaybePromise<readonly TMatch[]>;
  isDuplicate: (input: DedupeDecisionInput<TItem, TMatch>) => MaybePromise<boolean>;
  key?: (item: TItem) => string | null | undefined;
}

export interface DedupeExtractedItemsResult<TItem, TMatch> {
  newItems: TItem[];
  duplicates: DuplicateExtraction<TItem, TMatch>[];
}

type MaybePromise<T> = T | Promise<T>;

/**
 * Filters extraction candidates through caller-owned search logic.
 *
 * The conversation-analysis subsystem does not know how a destination store
 * decides sameness. Memory can search semantically; another consumer might use
 * exact keys or a remote index.
 */
export async function dedupeExtractedItems<TItem, TMatch>(
  items: readonly TItem[],
  options: DedupeExtractedItemsOptions<TItem, TMatch>,
): Promise<DedupeExtractedItemsResult<TItem, TMatch>> {
  const newItems: TItem[] = [];
  const duplicates: DuplicateExtraction<TItem, TMatch>[] = [];
  const seenKeys = new Set<string>();

  for (const [index, item] of items.entries()) {
    const key = options.key?.(item) ?? null;
    if (key && seenKeys.has(key)) {
      duplicates.push({ item, index, matches: [] });
      continue;
    }

    const matches = await options.search({ item, index });
    const duplicate = await options.isDuplicate({ item, index, matches });
    if (duplicate) {
      duplicates.push({ item, index, matches });
      continue;
    }

    if (key) seenKeys.add(key);
    newItems.push(item);
  }

  return { newItems, duplicates };
}
