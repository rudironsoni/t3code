import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  DEFAULT_WORKFLOW_SKIPPED_RUNS_KEPT,
  MAX_WORKFLOW_SKIPPED_RUNS_KEPT,
  isManagedSettingPath,
  type EnvironmentId,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { type StaticScreenProps } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { NoWorkflowHost, useWorkflowHost, WorkflowHostPicker } from "./WorkflowHostPicker";

export function WorkflowHostSettingsScreen({
  route,
}: StaticScreenProps<{ readonly environmentId?: EnvironmentId } | undefined>) {
  const gt = useGT();
  const [selected, setSelected] = useState(route.params?.environmentId);
  const { environments, host } = useWorkflowHost(selected);

  return (
    <SettingsScreen title={gt("Workflow settings")}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <WorkflowHostPicker
          environments={environments}
          selected={host?.environmentId}
          onSelect={setSelected}
        />
        {host === undefined ? (
          <NoWorkflowHost />
        ) : (
          <WorkflowHostControls
            key={host.environmentId}
            environmentId={host.environmentId}
            connected={host.connection.phase === "connected"}
          />
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

function WorkflowHostControls(props: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const { environmentId, connected } = props;
  const gt = useGT();
  const resolve = useMessages();
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  if (!config) {
    return (
      <Text className="px-5 py-3 text-foreground-muted">
        {connected
          ? gt("Workflow settings are unavailable on this connection.")
          : gt("Not connected")}
      </Text>
    );
  }

  const { workflowsEnabled, workflowSkippedRunsKept } = config.settings;
  const policy = config.managedPolicy;
  const managedReason = (key: "workflowsEnabled" | "workflowSkippedRunsKept") =>
    policy && isManagedSettingPath(policy, key)
      ? gt("Managed by {organization}.", { organization: policy.organization })
      : undefined;
  const enabledReason = managedReason("workflowsEnabled");
  const retentionReason = managedReason("workflowSkippedRunsKept");
  const writable = connected && canWrite;
  const canToggle = writable && enabledReason === undefined;
  const canSetRetention = writable && retentionReason === undefined;
  const value = draft ?? String(workflowSkippedRunsKept);
  const count = /^\d+$/.test(value) ? Number(value) : NaN;
  const valid = Number.isInteger(count) && count >= 0 && count <= MAX_WORKFLOW_SKIPPED_RUNS_KEPT;

  const write = async (patch: ServerSettingsPatch) => {
    if (
      pending.current ||
      !connected ||
      !readEnvironmentScope(environmentId, AuthSettingsWriteScope)
    )
      return;
    pending.current = true;
    setSaving(true);
    setError(null);
    const completed = await settlePromise(() => update({ environmentId, input: { patch } }));
    pending.current = false;
    setSaving(false);
    if (completed._tag === "Failure")
      setError(formatEnvironmentQueryError(completed.cause, resolve));
    else if (completed.value._tag === "Failure")
      setError(formatEnvironmentQueryError(completed.value.cause, resolve));
    else if (patch.workflowSkippedRunsKept !== undefined) setDraft(null);
  };

  return (
    <View className="gap-4 px-5 pb-8 pt-3">
      <SettingsSection title={gt("Workflows")}>
        <SettingsSwitchRow
          icon="point.3.connected.trianglepath.dotted"
          label={gt("Enable Workflows")}
          subtitle={
            enabledReason ?? gt("While off, existing runs wait until you turn Workflows on again.")
          }
          value={workflowsEnabled}
          disabled={!canToggle || saving}
          onValueChange={(enabled) => void write({ workflowsEnabled: enabled })}
        />
      </SettingsSection>
      {workflowsEnabled ? (
        <SettingsSection title={gt("Skipped runs kept")}>
          <View className="gap-3 p-4">
            <Text className="text-sm text-foreground-muted">
              {retentionReason ??
                gt(
                  "The number of skipped runs to keep per workflow. Runs that did work are always kept.",
                )}
            </Text>
            <TextInput
              accessibilityLabel={gt("Skipped runs kept")}
              editable={canSetRetention && !saving}
              keyboardType="number-pad"
              value={value}
              onChangeText={setDraft}
            />
            {valid ? null : (
              <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                {gt("Enter a whole number from 0 to {max}.", {
                  max: MAX_WORKFLOW_SKIPPED_RUNS_KEPT,
                })}
              </Text>
            )}
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={gt("Save", { $context: "verb, confirm button" })}
                disabled={!canSetRetention || !valid || count === workflowSkippedRunsKept || saving}
                onPress={() => void write({ workflowSkippedRunsKept: count })}
              />
              <Button
                label={gt("Reset skipped runs kept to default")}
                tone="text"
                disabled={
                  !canSetRetention ||
                  saving ||
                  workflowSkippedRunsKept === DEFAULT_WORKFLOW_SKIPPED_RUNS_KEPT
                }
                onPress={() =>
                  void write({ workflowSkippedRunsKept: DEFAULT_WORKFLOW_SKIPPED_RUNS_KEPT })
                }
              />
            </View>
          </View>
        </SettingsSection>
      ) : null}
      {writable ? null : (
        <Text className="text-sm text-foreground-muted">
          {connected ? gt("Read-only") : gt("Not connected")}
        </Text>
      )}
      {error === null ? null : (
        <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
          {error}
        </Text>
      )}
    </View>
  );
}
