import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";

export function WorkflowHostPicker(props: {
  readonly environments: readonly EnvironmentPresentation[];
  readonly selected: EnvironmentId | undefined;
  readonly onSelect: (environmentId: EnvironmentId) => void;
}) {
  if (
    props.environments.length === 0 ||
    (props.environments.length === 1 && props.selected !== undefined)
  )
    return null;
  return (
    <View className="flex-row flex-wrap gap-x-2 px-5 py-2">
      {props.environments.map((environment) => (
        <WorkflowPickerChip
          key={environment.environmentId}
          label={workflowHostLabel(environment, props.environments)}
          selected={environment.environmentId === props.selected}
          onPress={() => props.onSelect(environment.environmentId)}
        />
      ))}
    </View>
  );
}

export function useWorkflowHost(selected: EnvironmentId | undefined) {
  const { environments } = useEnvironments();
  return {
    environments,
    host:
      selected === undefined
        ? environments[0]
        : environments.find((environment) => environment.environmentId === selected),
  };
}

export function NoWorkflowHost() {
  const gt = useGT();
  return (
    <EmptyState
      variant="plain"
      title={gt("No environment connected")}
      detail={gt("Connect or select an environment to manage workflows.")}
    />
  );
}

export function workflowHostLabel(
  host: EnvironmentPresentation,
  environments: readonly EnvironmentPresentation[],
) {
  const duplicate = environments.some(
    (environment) =>
      environment.environmentId !== host.environmentId && environment.label === host.label,
  );
  return duplicate ? (host.displayUrl ?? host.label) : host.label;
}

export function WorkflowPickerChip(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.selected }}
      className="min-h-[44px] justify-center active:opacity-70 android:min-h-[48px]"
      onPress={props.onPress}
    >
      <Chip label={props.label} selected={props.selected} />
    </Pressable>
  );
}
