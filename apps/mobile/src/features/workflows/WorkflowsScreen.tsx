import {
  defaultWorkflowListTab,
  groupWorkflowRuns,
  listedWorkflowRuns,
  workflowChip,
  workflowQuestionKinds,
  workflowRunAsksKind,
  workflowRunInvolves,
  workflowRunLists,
  workflowRunNow,
  workflowRunState,
  type WorkflowListTab,
  type WorkflowRunNode,
  type WorkflowRunTone,
} from "@t3tools/client-runtime/workflows";
import {
  AuthFilesystemReadScope,
  type EnvironmentId,
  type WorkflowRunsSnapshot,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { StackActions, useNavigation } from "@react-navigation/native";
import { msg, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/ui/Button";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { useEnvironmentsWithScope } from "../../state/session";
import { RelativeTime } from "../../components/RelativeTime";
import { AppText as Text } from "../../components/ui/AppText";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { cn } from "../../lib/cn";
import { useEnvironments } from "../../state/environments";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { workflowHostLabel, WorkflowPickerChip } from "./WorkflowHostPicker";
import { useWorkflowSubjectOpener, workflowSubjectLine } from "./WorkflowSubject";

const TABS = [
  {
    value: "needs-you",
    label: msg("Needs you", { $context: "tab, workflow runs waiting on the user" }),
  },
  { value: "running", label: msg("Running", { $context: "tab, workflow runs under way" }) },
  { value: "all", label: msg("All", { $context: "tab, all workflow runs" }) },
] as const satisfies ReadonlyArray<{ readonly value: WorkflowListTab; readonly label: string }>;

const NOTHING: Record<WorkflowListTab, string> = {
  "needs-you": msg("Nothing waits on you."),
  running: msg("Nothing is running."),
  all: msg("No runs yet."),
};

export const WORKFLOW_TONE_CLASS: Record<WorkflowRunTone, string> = {
  input: "text-warning-foreground",
  failed: "text-danger-foreground",
  working: "text-primary",
  quiet: "text-foreground-muted",
  done: "text-foreground-muted",
};

// The same few colours every time for one workflow, so a list is read by its marks.
const CHIP_CLASS = [
  "bg-primary/15 text-primary",
  "bg-warning/20 text-warning-foreground",
  "bg-danger/15 text-danger-foreground",
  "bg-subtle-strong text-foreground-secondary",
  "bg-foreground/10 text-foreground",
] as const;

export function WorkflowChip(props: { readonly name: string }) {
  const chip = workflowChip(props.name);
  const [surface, text] = (CHIP_CLASS[chip.tone % CHIP_CLASS.length] ?? CHIP_CLASS[0]).split(" ");
  return (
    <View className={cn("h-5 w-6 items-center justify-center rounded-md", surface)}>
      <Text className={cn("font-t3-bold text-3xs", text)}>{chip.letters}</Text>
    </View>
  );
}

function RunRow(props: {
  readonly node: WorkflowRunNode;
  readonly onOpen: () => void;
  /** Null when the run has no subject, or one this device cannot open. */
  readonly onOpenSubject: (() => void) | null;
}) {
  const { run } = props.node;
  const m = useMessages();
  const state = workflowRunState(props.node, m);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${run.title}, ${state.word}`}
      className="gap-1 border-b border-border-subtle px-5 py-3 active:bg-subtle"
      onPress={props.onOpen}
    >
      <View className="flex-row items-center gap-2">
        <WorkflowChip name={run.workflow} />
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
          {run.workflow}
        </Text>
        <Text className={cn("font-t3-medium text-xs", WORKFLOW_TONE_CLASS[state.tone])}>
          {state.word}
        </Text>
      </View>
      <Text className="font-t3-medium text-base text-foreground" numberOfLines={1}>
        {run.title}
      </Text>
      {run.subject === undefined ? null : (
        <Pressable
          accessibilityRole="link"
          disabled={props.onOpenSubject === null}
          onPress={props.onOpenSubject ?? undefined}
          hitSlop={6}
          className="self-start active:opacity-60"
        >
          <Text
            className={cn(
              "text-xs",
              props.onOpenSubject === null ? "text-foreground-secondary" : "text-primary",
            )}
            numberOfLines={1}
          >
            {workflowSubjectLine(run.subject)}
          </Text>
        </Pressable>
      )}
      <View className="flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
          {workflowRunNow(props.node, m)}
        </Text>
        <Text className="text-xs text-foreground-muted">
          <RelativeTime timestamp={run.updatedAt} />
        </Text>
      </View>
    </Pressable>
  );
}

/** One environment's runs in the picked list. */
function EnvironmentRuns(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string | null;
  readonly snapshot: WorkflowRunsSnapshot;
  readonly tab: WorkflowListTab;
  readonly workflow: string | null;
  /** The kind of question to narrow Needs you to; null for every run in it. */
  readonly kind: string | null;
}) {
  const navigation = useNavigation();
  const gt = useGT();
  const m = useMessages();
  const subjectOpener = useWorkflowSubjectOpener(props.environmentId);
  const [showSkipped, setShowSkipped] = useState(false);
  const { snapshot, tab, workflow } = props;
  const visible = listedWorkflowRuns(snapshot.runs, showSkipped);
  const inTab = workflowRunLists(
    groupWorkflowRuns(snapshot.workflows, visible.runs, snapshot.questions),
  )[tab].filter((node) => workflow === null || workflowRunInvolves(node, workflow));
  const skipped =
    workflow === null
      ? visible.skipped
      : listedWorkflowRuns(
          snapshot.runs.filter((run) => run.workflow === workflow),
          false,
        ).skipped;
  const kind = tab === "needs-you" ? props.kind : null;
  const listed =
    kind === null
      ? inTab
      : inTab.filter((node) => workflowRunAsksKind(snapshot.workflows, node, kind));
  return (
    <View>
      {props.label === null ? null : (
        <Text className="px-5 pb-1 pt-3 font-t3-medium text-xs text-foreground-muted">
          {props.label}
        </Text>
      )}
      {listed.length === 0 ? (
        <Text className="px-5 py-6 text-center text-sm text-foreground-muted">
          {kind === null ? m(NOTHING[tab]) : gt("No questions of this kind wait on you.")}
        </Text>
      ) : (
        listed.map((node) => (
          <RunRow
            key={node.run.runId}
            node={node}
            onOpenSubject={node.run.subject === undefined ? null : subjectOpener(node.run.subject)}
            onOpen={() =>
              navigation.navigate("WorkflowRun", {
                environmentId: props.environmentId,
                runId: node.run.runId,
              })
            }
          />
        ))
      )}
      {tab === "all" && skipped > 0 ? (
        <Pressable
          accessibilityRole="button"
          className="items-center px-5 py-4"
          onPress={() => setShowSkipped(!showSkipped)}
        >
          <Text className="text-xs text-foreground-muted">
            {showSkipped ? gt("Hide skipped") : gt("Show {count} skipped", { count: skipped })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const TAB_ORDER: ReadonlyArray<WorkflowListTab> = ["needs-you", "running", "all"];

/** What waits on a person in each environment, as the kinds of question are counted from. */
const needsYouSources = (snapshots: ReadonlyArray<WorkflowRunsSnapshot>, workflow: string | null) =>
  snapshots.map((snapshot) => ({
    workflows: snapshot.workflows,
    nodes: workflowRunLists(
      groupWorkflowRuns(
        snapshot.workflows,
        listedWorkflowRuns(snapshot.runs, false).runs,
        snapshot.questions,
      ),
    )["needs-you"].filter((node) => workflow === null || workflowRunInvolves(node, workflow)),
  }));

/** The Workflows tab: what waits on you first, in every environment this device is connected to. */
export function SettingsWorkflowsRouteScreen() {
  const gt = useGT();
  return (
    <SettingsScreen title={gt("Workflows")}>
      <WorkflowsScreen />
    </SettingsScreen>
  );
}

export function WorkflowsScreen() {
  const navigation = useNavigation();
  const { environments, isReady } = useEnvironments();
  const [tab, setTab] = useState<WorkflowListTab | null>(null);
  const [workflow, setWorkflow] = useState<string | null>(null);
  const canReadDefinitions = useEnvironmentsWithScope(environments, AuthFilesystemReadScope);
  const openDefinitions = (environmentId?: EnvironmentId) =>
    navigation.dispatch(
      StackActions.push(
        "WorkflowDefinitions",
        environmentId === undefined ? undefined : { environmentId },
      ),
    );
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const m = useMessages();
  const live = useAtomValue(
    serverEnvironment.workflowsLiveAcross(
      JSON.stringify(environments.map((environment) => environment.environmentId)),
    ),
  );
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  if (isReady && environments.length === 0) {
    return (
      <EmptyState
        variant="plain"
        title={gt("No environment connected")}
        detail={gt("Connect an environment to see its workflow runs.")}
      />
    );
  }
  const sections = environments.map((environment) => {
    const result = live.find((entry) => entry.environmentId === environment.environmentId)?.result;
    return {
      environment,
      snapshot: result === undefined ? null : Option.getOrNull(AsyncResult.value(result)),
      error: result?._tag === "Failure" ? formatEnvironmentQueryError(result.cause, m) : null,
    };
  });
  const withRuns = sections.flatMap(({ environment, snapshot }) =>
    snapshot !== null && snapshot.runs.length > 0 ? [{ environment, snapshot }] : [],
  );
  const workflows = [
    ...new Set(
      sections.flatMap(({ snapshot }) =>
        snapshot === null
          ? []
          : [
              ...snapshot.workflows.map(({ name }) => name),
              ...snapshot.runs.map((run) => run.workflow),
            ],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const workflowOptions =
    workflow === null || workflows.includes(workflow) ? workflows : [workflow, ...workflows];
  const settled = sections.every(({ snapshot, error }) => snapshot !== null || error !== null);
  // Open on the most pressing list any environment has.
  const opening =
    TAB_ORDER.find((candidate) =>
      withRuns.some(
        ({ snapshot }) =>
          defaultWorkflowListTab(
            groupWorkflowRuns(snapshot.workflows, snapshot.runs, snapshot.questions),
          ) === candidate,
      ),
    ) ?? "all";
  const shown = tab ?? opening;
  // The pick stays when its last question is answered: the rest must not appear in its place.
  const kind =
    shown === "needs-you" && AsyncResult.isSuccess(preferences)
      ? (preferences.value.workflowQuestionKind ?? null)
      : null;
  const kinds =
    shown === "needs-you"
      ? workflowQuestionKinds(
          needsYouSources(
            withRuns.map(({ snapshot }) => snapshot),
            workflow,
          ),
          kind,
        )
      : [];
  const pickKind = (next: string | undefined) => {
    // Held here, so answering the kind's last question does not move the list on.
    setTab("needs-you");
    void savePreferences({ workflowQuestionKind: next });
  };
  return (
    <ScreenScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
    >
      <View className="flex-row flex-wrap gap-2 px-5 pt-3">
        <Button label={gt("Definitions")} onPress={() => openDefinitions()} />
        <Button
          label={gt("Workflow settings")}
          onPress={() => navigation.navigate("SettingsWorkflowHost")}
        />
      </View>
      {sections.map(({ environment, snapshot }) => {
        const problem = snapshot?.definition?.problem;
        if (!problem) return null;
        return (
          <View
            key={environment.environmentId}
            className="mx-5 mt-3 gap-2 rounded-xl border border-danger-border p-3"
          >
            <Text accessibilityRole="alert" className="font-t3-medium text-danger-foreground">
              {gt("A workflow file has a problem.")}
            </Text>
            {environments.length > 1 ? (
              <Text className="text-sm text-foreground">
                {workflowHostLabel(environment, environments)}
              </Text>
            ) : null}
            <Text className="text-sm text-foreground">{problem}</Text>
            {canReadDefinitions.has(environment.environmentId) ? (
              <Button
                label={gt("Open definitions")}
                tone="text"
                onPress={() => openDefinitions(environment.environmentId)}
              />
            ) : null}
          </View>
        );
      })}
      {sections.flatMap(({ environment, snapshot, error }) =>
        snapshot === null && error !== null
          ? [
              <Text
                key={`error:${environment.environmentId}`}
                className="px-5 py-3 text-sm text-danger-foreground"
              >
                {environments.length > 1
                  ? `${workflowHostLabel(environment, environments)}: ${error}`
                  : error}
              </Text>,
            ]
          : [],
      )}
      {withRuns.length === 0 && workflowOptions.length === 0 ? (
        settled ? (
          <EmptyState
            variant="plain"
            title={gt("No workflow runs yet")}
            detail={gt(
              "A workflow ties agents, code, schedules and questions to you into one run that survives restarts.",
            )}
          />
        ) : null
      ) : (
        <>
          <View className="px-5 pb-2 pt-3">
            <SegmentedControl
              options={TABS.map((option) => ({ ...option, label: m(option.label) }))}
              selected={shown}
              onSelect={setTab}
              role="tab"
            />
          </View>
          {workflowOptions.length === 0 ? null : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2 px-5 pb-2"
            >
              <WorkflowPickerChip
                label={gt("All workflows")}
                selected={workflow === null}
                onPress={() => setWorkflow(null)}
              />
              {workflowOptions.map((name) => (
                <WorkflowPickerChip
                  key={name}
                  label={name}
                  selected={workflow === name}
                  onPress={() => setWorkflow(name)}
                />
              ))}
            </ScrollView>
          )}
          {kinds.length === 0 ? null : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2 px-5 pb-2"
            >
              <Chip
                label={gt("All kinds", { $context: "filter, every kind of workflow question" })}
                selected={kind === null}
                onPress={() => pickKind(undefined)}
              />
              {kinds.map((candidate) => (
                <Chip
                  key={candidate.kind}
                  label={`${
                    candidate.label ??
                    gt("Other", { $context: "workflow questions that have no kind" })
                  } ${candidate.count}`}
                  selected={kind === candidate.kind}
                  onPress={() => pickKind(candidate.kind)}
                />
              ))}
            </ScrollView>
          )}
          {withRuns.length === 0 && settled ? (
            <Text className="px-5 py-6 text-center text-sm text-foreground-muted">
              {m(NOTHING[shown])}
            </Text>
          ) : null}
          {withRuns.map(({ environment, snapshot }) => (
            <EnvironmentRuns
              key={environment.environmentId}
              environmentId={environment.environmentId}
              label={environments.length > 1 ? workflowHostLabel(environment, environments) : null}
              snapshot={snapshot}
              tab={shown}
              workflow={workflow}
              kind={kind}
            />
          ))}
        </>
      )}
    </ScreenScrollView>
  );
}
