import type { OrchestrationV2SearchThreadInput, ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useRef, useState } from "react";
import { View, type TextInputInstance } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { SearchField } from "../../components/ui/SearchField";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useDebouncedValue } from "../../state/queries";

const emptySearch = { query: "", navigation: null };

export function useThreadFind(thread: ScopedThreadRef | null) {
  const [search, setSearch] = useState<{
    query: string;
    navigation: Pick<OrchestrationV2SearchThreadInput, "start" | "offset"> | null;
  }>(emptySearch);
  if (thread === null && search !== emptySearch) setSearch(emptySearch);

  const query = search.query.trim();
  const debounced = useDebouncedValue(query, 180);
  const atom =
    thread !== null && query === debounced && query.length > 0
      ? orchestrationEnvironment.threadFind({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId, query, ...search.navigation },
        })
      : null;
  const response = useEnvironmentQuery(atom);
  const result = response.successResult?.value ?? null;
  return {
    query: search.query,
    pending: query.length > 0 && result === null && response.error === null,
    error: response.error,
    result,
    setQuery: (value: string) => setSearch({ query: value.slice(0, 200), navigation: null }),
    step: (offset: number) => {
      if (!result?.match || result.totalMatches < 2) return;
      const { entryId, occurrence } = result.match;
      setSearch({ query: search.query, navigation: { start: { entryId, occurrence }, offset } });
    },
  };
}

export function ThreadFindBar({
  find,
  onClose,
}: {
  readonly find: ReturnType<typeof useThreadFind>;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const inputRef = useRef<TextInputInstance | null>(null);
  const canStep = (find.result?.totalMatches ?? 0) > 1;
  const status = find.pending
    ? gt("Searching…")
    : find.error
      ? find.error
      : find.result === null
        ? null
        : find.result.totalMatches === 0
          ? gt("No matches")
          : gt("{current} of {total}", {
              current: find.result.activeIndex + 1,
              total: find.result.totalMatches,
            });

  return (
    <View className="bg-screen px-2 py-1">
      <View className="flex-row items-center">
        <SearchField
          inputRef={inputRef}
          accessibilityLabel={gt("Find in thread")}
          placeholder={gt("Find in thread")}
          clearAccessibilityLabel={gt("Clear search")}
          value={find.query}
          onChangeText={find.setQuery}
        />
        <IconButton
          icon="chevron.up"
          accessibilityLabel={gt("Previous match")}
          disabled={!canStep}
          onPress={() => find.step(-1)}
        />
        <IconButton
          icon="chevron.down"
          accessibilityLabel={gt("Next match")}
          disabled={!canStep}
          onPress={() => find.step(1)}
        />
        <IconButton icon="xmark" accessibilityLabel={gt("Close search")} onPress={onClose} />
      </View>
      {status !== null ? (
        <AppText
          accessibilityLiveRegion="polite"
          className="px-2 pb-1 text-sm text-foreground-secondary"
        >
          {status}
        </AppText>
      ) : null}
    </View>
  );
}
