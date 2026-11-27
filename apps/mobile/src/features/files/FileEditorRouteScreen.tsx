import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type ProjectReadFileResult,
  type ProjectWriteFileInput,
} from "@t3tools/contracts";
import { useNavigation, usePreventRemove, type StaticScreenProps } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { useContext, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingScreen } from "../../components/LoadingScreen";
import { AppBar } from "../../components/ui/AppBar";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useContentTopInset } from "../../components/ui/useBarInset";
import { projectEnvironment } from "../../state/projects";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { basename } from "./filePath";
import { FilePreviewNotice } from "./FilePreviewFeedback";

export function canEditWorkspaceFile(
  file: ProjectReadFileResult | null | undefined,
): file is ProjectReadFileResult {
  return file != null && file.exists !== false && !file.truncated && file.byteLength <= 256 * 1024;
}

type FileEditorParams = { readonly environmentId: EnvironmentId } & Pick<
  ProjectWriteFileInput,
  "cwd" | "relativePath"
>;

export function FileEditorRouteScreen({ route }: StaticScreenProps<FileEditorParams>) {
  const navigation = useNavigation();
  const gt = useGT();
  const resolve = useMessages();
  const registry = useContext(RegistryContext);
  const topInset = useContentTopInset();
  const { environmentId, cwd, relativePath } = route.params;
  const canWrite = useAtomValue(projectEnvironment.writeFile.permissionAtom(environmentId));
  const fileAtom = projectEnvironment.readFile({ environmentId, input: { cwd, relativePath } });
  const file = useEnvironmentQuery(fileAtom);
  const write = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const [draft, setDraft] = useState<{ original: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const saved = useRef(false);
  const source = file.successResult?.value;
  const original = draft?.original ?? (canEditWorkspaceFile(source) ? source.contents : null);
  const usesCrlf =
    original !== null &&
    original.includes("\r\n") &&
    !original.replaceAll("\r\n", "").includes("\n");
  const initialText = usesCrlf ? original.replaceAll("\r\n", "\n") : original;
  const text = draft?.text ?? initialText;
  const dirty = draft !== null && draft.text !== initialText;

  usePreventRemove(dirty || saving, ({ data }) => {
    if (saved.current) {
      navigation.dispatch(data.action);
    } else if (!inFlight.current) {
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

  const save = async () => {
    if (!canWrite || !dirty || draft === null || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const contents = usesCrlf ? draft.text.replace(/\r?\n/g, "\r\n") : draft.text;
    const failure = await executeAtomQuery(registry, fileAtom, {
      refresh: true,
      reportFailure: false,
    })
      .then(async (current) => {
        if (current._tag === "Failure") return formatEnvironmentQueryError(current.cause, resolve);
        if (!canEditWorkspaceFile(current.value) || current.value.contents !== draft.original) {
          return gt("The file changed on the host. Copy your edits before reopening the file.");
        }
        const result = await write({ environmentId, input: { cwd, relativePath, contents } });
        return result._tag === "Failure"
          ? formatEnvironmentQueryError(result.cause, resolve)
          : null;
      })
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
    if (failure !== null) {
      Dialog.alert(gt("Could not save file"), failure);
      return;
    }
    saved.current = true;
    file.refresh();
    navigation.goBack();
  };

  return (
    <View className="flex-1 bg-sheet">
      <AppBar
        title={basename(relativePath)}
        subtitle={relativePath}
        onClose={() => navigation.goBack()}
        closeAccessibilityLabel={gt("Cancel")}
        confirm={{
          label: gt("Save", { $context: "verb, confirm button" }),
          disabled: !canWrite || !dirty,
          loading: saving,
          onPress: () => void save(),
        }}
      />
      <ScreenContent>
        <KeyboardAvoidingView
          automaticOffset
          behavior="padding"
          className="flex-1"
          style={{ paddingTop: topInset }}
        >
          <SafeAreaView edges={["bottom", "left", "right"]} className="flex-1">
            {text !== null && original !== null ? (
              <TextInput
                accessibilityLabel={gt("File contents")}
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 px-4 py-3 font-mono text-base text-foreground"
                editable={!saving}
                multiline
                onChangeText={(text) => setDraft({ original, text })}
                spellCheck={false}
                style={{ textAlignVertical: "top" }}
                value={text}
              />
            ) : file.isPending ? (
              <LoadingScreen message={gt("Opening file...")} messagePlacement="above-spinner" />
            ) : (
              <FilePreviewNotice>{file.error ?? gt("File unavailable")}</FilePreviewNotice>
            )}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </ScreenContent>
    </View>
  );
}
