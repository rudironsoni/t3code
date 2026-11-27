import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { executeAtomQuery, settlePromise } from "@t3tools/client-runtime/state/runtime";
import {
  AuthFilesystemReadScope,
  type EnvironmentId,
  type WorkflowDefinitionFile,
  type WorkflowDefinitionFiles,
  type WorkflowDefinitionProblem,
} from "@t3tools/contracts";
import { useNavigation, usePreventRemove, type StaticScreenProps } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { useContext, useRef, useState } from "react";
import { View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ListRow } from "../../components/ui/ListRow";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useBarOverlap } from "../../components/ui/useBarInset";
import { useEnvironments } from "../../state/environments";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { FileEditorInput } from "../files/FileEditorRouteScreen";
import { NoWorkflowHost, useWorkflowHost, WorkflowHostPicker } from "./WorkflowHostPicker";

const NEW_FILE = `const { workflow } = T3;

workflow(
  "my-workflow",
  { version: 1, payload: Schema.Struct({}) },
  Effect.fn(function* () {}),
);
`;

function Problems(props: { readonly problems: readonly WorkflowDefinitionProblem[] }) {
  const gt = useGT();
  if (props.problems.length === 0) return null;
  return (
    <View accessibilityRole="alert" className="gap-1 border-b border-danger-border px-4 py-2">
      {props.problems.map(({ file, line, message }) => (
        <Text
          key={JSON.stringify([file, line, message])}
          className="text-sm text-danger-foreground"
        >
          {[file, line === undefined ? undefined : gt("Line {line}", { line }), message]
            .filter(Boolean)
            .join(": ")}
        </Text>
      ))}
    </View>
  );
}

export function WorkflowDefinitionsScreen({
  route,
}: StaticScreenProps<{ readonly environmentId?: EnvironmentId } | undefined>) {
  const gt = useGT();
  const navigation = useNavigation();
  const [selected, setSelected] = useState(route.params?.environmentId);
  const { environments, host } = useWorkflowHost(selected);
  return (
    <View className="flex-1 bg-screen">
      <AppBar title={gt("Workflow definitions")} onBack={() => navigation.goBack()} />
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
          <DefinitionList
            key={host.environmentId}
            environmentId={host.environmentId}
            connected={host.connection.phase === "connected"}
          />
        )}
      </ScreenScrollView>
    </View>
  );
}

function DefinitionList({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const canRead = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const canSave = useAtomValue(
    serverEnvironment.saveWorkflowDefinition.permissionAtom(environmentId),
  );
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const enabled = config?.settings.workflowsEnabled;
  const query = useEnvironmentQuery(
    canRead && enabled !== false
      ? serverEnvironment.workflowDefinition({ environmentId, input: {} })
      : null,
  );
  const [naming, setNaming] = useState<string | null>(null);
  const open = (name: string, create?: true) =>
    navigation.navigate("WorkflowDefinition", { environmentId, name, create });
  const name = naming?.trim() ?? "";
  const filename = /\.(ts|mts|js|mjs)$/.test(name) ? name : `${name}.ts`;
  const alreadyExists = query.data?.files.some((file) => file.name === filename) === true;
  const create = () => {
    if (!name || alreadyExists || !canSave || !connected) return;
    open(filename, true);
    setNaming(null);
  };
  if (!canRead || enabled === false || query.data === null) {
    const detail = !canRead
      ? gt("This connection cannot read workflow files.")
      : enabled === false
        ? gt("Turn on Workflows for this environment to access its definitions.")
        : (query.error ?? gt("Loading the workflow files…"));
    return (
      <View className="gap-2 px-5 py-3">
        <Text className="text-sm text-foreground-muted">{detail}</Text>
        {enabled === false ? (
          <Button
            label={gt("Workflow settings")}
            onPress={() => navigation.navigate("SettingsWorkflowHost", { environmentId })}
          />
        ) : null}
      </View>
    );
  }
  const { directory, files, problems, single } = query.data;
  return (
    <View className="gap-2 px-5 pb-8 pt-3">
      <Text className="text-sm text-foreground-muted" selectable>
        {directory}
      </Text>
      <Problems problems={problems} />
      {query.error === null ? null : <Problems problems={[{ message: query.error }]} />}
      {files.map((file) => (
        <ListRow
          key={file.name}
          icon={file.problems.length === 0 ? "doc.text" : "exclamationmark.triangle"}
          label={file.name}
          description={file.problems[0]?.message ?? file.workflows.join(", ")}
          onPress={() => open(file.name)}
        />
      ))}
      {files.length === 0 ? (
        <Text className="text-sm text-foreground-muted">{gt("No workflow files")}</Text>
      ) : null}
      {single || !canSave || !connected ? null : naming === null ? (
        <Button label={gt("New file")} icon="plus" onPress={() => setNaming("")} />
      ) : (
        <View className="gap-2">
          <TextInput
            accessibilityLabel={gt("File name")}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            value={naming}
            onChangeText={setNaming}
            onSubmitEditing={create}
          />
          {alreadyExists ? (
            <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
              {gt("A file with this name already exists.")}
            </Text>
          ) : null}
          <View className="flex-row gap-2">
            <Button
              label={gt("Continue")}
              disabled={name === "" || alreadyExists}
              onPress={create}
            />
            <Button label={gt("Cancel")} tone="text" onPress={() => setNaming(null)} />
          </View>
        </View>
      )}
    </View>
  );
}

type EditorParams = {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly create?: true | undefined;
};

export function WorkflowDefinitionEditorScreen({ route }: StaticScreenProps<EditorParams>) {
  const { environmentId, name } = route.params;
  const gt = useGT();
  const navigation = useNavigation();
  const topInset = useBarOverlap();
  const canRead = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const query = useEnvironmentQuery(
    canRead ? serverEnvironment.workflowDefinition({ environmentId, input: {} }) : null,
  );
  if (query.data === null) {
    return (
      <View className="flex-1 bg-sheet">
        <AppBar title={name} onClose={() => navigation.goBack()} />
        <Text className="px-4 py-2 text-foreground-muted" style={{ marginTop: topInset }}>
          {!canRead
            ? gt("This connection cannot read workflow files.")
            : (query.error ?? gt("Loading the workflow files…"))}
        </Text>
      </View>
    );
  }
  const file = readDefinitionFile(query.data, name);
  return (
    <DefinitionEditor
      key={JSON.stringify([environmentId, name])}
      target={route.params}
      file={file}
      single={query.data.single}
    />
  );
}

function DefinitionEditor({
  target,
  file,
  single,
}: {
  readonly target: EditorParams;
  readonly file: WorkflowDefinitionFile | undefined;
  readonly single: boolean;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const navigation = useNavigation();
  const registry = useContext(RegistryContext);
  const topInset = useBarOverlap();
  const { environmentId, name } = target;
  const { presentationById } = useEnvironments();
  const connected = presentationById.get(environmentId)?.connection.phase === "connected";
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canSave = useAtomValue(
    serverEnvironment.saveWorkflowDefinition.permissionAtom(environmentId),
  );
  const canDelete = useAtomValue(
    serverEnvironment.deleteWorkflowDefinition.permissionAtom(environmentId),
  );
  const saveFile = useAtomCommand(serverEnvironment.saveWorkflowDefinition, {
    reportFailure: false,
  });
  const deleteFile = useAtomCommand(serverEnvironment.deleteWorkflowDefinition, {
    reportFailure: false,
  });
  const query = serverEnvironment.workflowDefinition({ environmentId, input: {} });
  const { refresh } = useEnvironmentQuery(query);
  const [draft, setDraft] = useState<{ baseline: string | undefined; text: string } | null>(() =>
    file === undefined && target.create === true ? { baseline: undefined, text: NEW_FILE } : null,
  );
  const [outcome, setOutcome] = useState<{
    title: string;
    problems: readonly WorkflowDefinitionProblem[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const released = useRef(false);
  const text = draft?.text ?? file?.source ?? "";
  const dirty = draft !== null && draft.text !== draft.baseline && draft.text !== file?.source;
  const writable = connected && config?.settings.workflowsEnabled !== false;
  const stale = dirty && draft.baseline !== file?.source;

  usePreventRemove(dirty || busy, ({ data }) => {
    if (released.current) navigation.dispatch(data.action);
    else if (!inFlight.current) {
      Dialog.alert(gt("Discard changes?"), gt("Your unsaved changes will be lost."), [
        { text: gt("Keep editing"), style: "cancel" },
        {
          text: gt("Discard changes"),
          style: "destructive",
          onPress: () => navigation.dispatch(data.action),
        },
      ]);
    }
  });

  const change = async (action: "save" | "delete") => {
    if (
      inFlight.current ||
      !writable ||
      (action === "save" ? !canSave || !dirty : !canDelete || single)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    const title = action === "save" ? gt("Could not save file") : gt("Could not delete file");
    const completed = await settlePromise(async () => {
      const latest = await executeAtomQuery(registry, query, {
        refresh: true,
        reportFailure: false,
      });
      if (latest._tag === "Failure") {
        setOutcome({
          title,
          problems: [{ message: formatEnvironmentQueryError(latest.cause, resolve) }],
        });
        return;
      }
      const current = readDefinitionFile(latest.value, name);
      const expected = dirty ? draft.baseline : file?.source;
      if (current?.source !== expected) {
        setOutcome({
          title,
          problems: [
            {
              message: gt("The file changed on the host. Load the current file before continuing."),
            },
          ],
        });
        return;
      }
      const result =
        action === "save"
          ? await saveFile({ environmentId, input: { name, source: text } })
          : await deleteFile({ environmentId, input: { name } });
      if (result._tag === "Failure") {
        setOutcome({
          title,
          problems: [{ message: formatEnvironmentQueryError(result.cause, resolve) }],
        });
        return;
      }
      const { changed, problems } = result.value;
      if (changed && action === "delete") {
        refresh();
        released.current = true;
        navigation.goBack();
        if (problems.length > 0) {
          Dialog.alert(
            gt("File deleted with workflow errors"),
            problems.map((problem) => problem.message).join("\n"),
          );
        }
      } else if (changed) {
        const loaded = await executeAtomQuery(registry, query, {
          refresh: true,
          reportFailure: false,
        });
        setDraft(loaded._tag === "Success" ? null : { baseline: text, text });
        setOutcome({
          title: problems.length > 0 ? gt("Saved, but it does not run yet.") : gt("Saved"),
          problems,
        });
      } else {
        setOutcome({ title, problems });
      }
    });
    inFlight.current = false;
    setBusy(false);
    if (completed._tag === "Failure") {
      setOutcome({
        title,
        problems: [{ message: formatEnvironmentQueryError(completed.cause, resolve) }],
      });
    }
  };

  const confirmDelete = () =>
    Dialog.alert(
      gt("Delete {file}?", { file: name }),
      gt("You can no longer start the workflows in this file."),
      [
        { text: gt("Cancel"), style: "cancel" },
        { text: gt("Delete"), style: "destructive", onPress: () => void change("delete") },
      ],
    );

  return (
    <View className="flex-1 bg-sheet">
      <AppBar
        title={name}
        subtitle={
          !connected
            ? gt("Not connected")
            : !canSave
              ? gt("Read-only")
              : dirty
                ? gt("Unsaved changes")
                : null
        }
        onClose={() => navigation.goBack()}
        actions={
          file !== undefined && !single && canDelete
            ? [
                {
                  accessibilityLabel: gt("Delete"),
                  icon: "trash",
                  destructive: true,
                  disabled: !writable || busy,
                  onPress: confirmDelete,
                },
              ]
            : undefined
        }
        confirm={
          canSave
            ? {
                label: gt("Save", { $context: "verb, confirm button" }),
                disabled: !writable || !dirty || busy || stale,
                loading: busy,
                onPress: () => void change("save"),
              }
            : undefined
        }
      />
      <ScreenContent>
        <KeyboardAvoidingView
          automaticOffset
          behavior="padding"
          className="flex-1"
          style={{ paddingTop: topInset + 8 }}
        >
          <SafeAreaView edges={["bottom", "left", "right"]} style={{ flex: 1 }}>
            {outcome === null ? null : (
              <Text accessibilityRole="alert" className="px-4 py-2 text-sm text-foreground">
                {outcome.title}
              </Text>
            )}
            <Problems
              problems={outcome?.problems.length ? outcome.problems : (file?.problems ?? [])}
            />
            {stale ? (
              <View className="gap-2 px-4 py-2">
                <Text className="text-sm text-danger-foreground">
                  {gt("The file changed on the host.")}
                </Text>
                <Button
                  label={gt("Discard changes")}
                  disabled={busy}
                  onPress={() => {
                    setDraft(null);
                    setOutcome(null);
                  }}
                />
              </View>
            ) : null}
            {file === undefined && draft === null ? (
              <Text className="px-4 py-2 text-foreground-muted">{gt("File unavailable")}</Text>
            ) : (
              <FileEditorInput
                value={text}
                editable={canSave && !busy}
                onChangeText={(text) => {
                  setDraft({ baseline: dirty ? draft.baseline : file?.source, text });
                  setOutcome(null);
                }}
              />
            )}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </ScreenContent>
    </View>
  );
}

function readDefinitionFile(files: WorkflowDefinitionFiles, name: string) {
  return files.files.find((file) => file.name === name);
}
