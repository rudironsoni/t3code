import { useAtomValue } from "@effect/atom-react";
import {
  deriveAvailableInstanceId,
  deriveInstanceId,
} from "@t3tools/client-runtime/provider-instance-ids";
import {
  AuthProvidersManageScope,
  ProviderInstanceId,
  TextGeneratorConfig,
  TextGeneratorKind,
  type ServerProvider,
  type ServerSettings,
  type TextGeneratorModel,
} from "@t3tools/contracts";
import { Option, Schema } from "effect";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { SetupChoice, SetupField, useSetupAction } from "./ProviderSetupControls";
import type { SettingsTarget } from "./settings-environment-filter";

const decodeTextGenerator = Schema.decodeUnknownOption(TextGeneratorConfig);
const isTextGeneratorKind = Schema.is(TextGeneratorKind);

export function TextGeneratorSetup({
  environment,
  settings,
  providers,
}: {
  readonly environment: SettingsTarget;
  readonly settings: ServerSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const gt = useGT();
  const [editing, setEditing] = useState<ProviderInstanceId | "new" | null>(null);
  const entries = Object.entries(settings.textGenerators);
  const ids = new Set([
    ...entries.map(([id]) => id),
    ...Object.keys(settings.providerInstances ?? {}),
    ...providers.map((provider) => provider.instanceId),
  ]);
  return (
    <View className="border-t border-border-subtle">
      {entries.map(([id, config]) => (
        <View key={id}>
          <ListActionRow
            label={config.label ?? config.baseUrl}
            description={gt("Text generator")}
            icon="text.alignleft"
            onPress={() => setEditing(editing === id ? null : ProviderInstanceId.make(id))}
          />
          {editing === id ? (
            <TextGeneratorForm
              environment={environment}
              id={ProviderInstanceId.make(id)}
              saved={config}
              ids={ids}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </View>
      ))}
      <ListActionRow
        label={gt("Add text generator")}
        icon="plus"
        onPress={() => setEditing(editing === "new" ? null : "new")}
      />
      {editing === "new" ? (
        <TextGeneratorForm environment={environment} ids={ids} onClose={() => setEditing(null)} />
      ) : null}
    </View>
  );
}

function TextGeneratorForm({
  environment,
  id,
  saved,
  ids,
  onClose,
}: {
  readonly environment: SettingsTarget;
  readonly id?: ProviderInstanceId;
  readonly saved?: TextGeneratorConfig;
  readonly ids: ReadonlySet<string>;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const { environmentId } = environment;
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const list = useAtomCommand(serverEnvironment.listTextGeneratorModels, { reportFailure: false });
  const canList = useAtomValue(
    serverEnvironment.listTextGeneratorModels.permissionAtom(environmentId),
  );
  const { pending, run } = useSetupAction();
  const [label, setLabel] = useState(saved?.label ?? "");
  const [kind, setKind] = useState<TextGeneratorKind>(saved?.kind ?? "openaiCompatible");
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(saved?.enabled ?? true);
  const [models, setModels] = useState<ReadonlyArray<TextGeneratorModel> | null>(null);
  const keepKey = saved?.baseUrl === baseUrl.trim() && saved.kind === kind;
  const result = decodeTextGenerator({
    kind,
    ...(label.trim() ? { label: label.trim() } : {}),
    baseUrl: baseUrl.trim(),
    apiKey: key.trim() || (keepKey ? saved.apiKey : ""),
    enabled,
  });

  function save(generatorId: ProviderInstanceId, config: TextGeneratorConfig | null) {
    if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    return run(() =>
      update({ environmentId, input: { patch: { textGenerators: { [generatorId]: config } } } }),
    ).then((updated) => {
      if (updated) onClose();
    });
  }

  return (
    <View className="gap-2 px-4 pb-4">
      <SetupChoice
        label={gt("API type")}
        value={kind}
        options={[
          { value: "openaiCompatible", label: gt("OpenAI-compatible") },
          { value: "anthropic", label: "Anthropic" },
        ]}
        disabled={pending}
        onChange={(next) => {
          if (isTextGeneratorKind(next)) setKind(next);
        }}
      />
      <SetupField
        label={gt("Display name")}
        value={label}
        onChangeText={setLabel}
        editable={!pending}
      />
      <SetupField
        label={gt("Base URL")}
        value={baseUrl}
        onChangeText={setBaseUrl}
        editable={!pending}
        keyboardType="url"
      />
      <SetupField
        label={gt("API key")}
        value={key}
        placeholder={keepKey && saved.apiKey ? gt("Credential saved") : undefined}
        secureTextEntry
        editable={!pending}
        onChangeText={setKey}
      />
      <SettingsSwitchRow
        label={gt("Enabled")}
        value={enabled}
        disabled={pending}
        onValueChange={setEnabled}
      />
      {baseUrl.trim() && Option.isNone(result) ? (
        <Text className="text-danger">{gt("Enter a valid HTTP or HTTPS base URL.")}</Text>
      ) : null}
      <ListActionRow
        label={gt("Save text generator")}
        icon="checkmark"
        loading={pending}
        disabled={Option.isNone(result)}
        onPress={() => {
          if (Option.isNone(result)) return;
          const generatorId =
            id ??
            ProviderInstanceId.make(
              deriveAvailableInstanceId(
                (name) => deriveInstanceId("text", name) || "text",
                label,
                ids,
              ),
            );
          void save(generatorId, result.value);
        }}
      />
      {id && saved ? (
        <>
          {canList ? (
            <ListActionRow
              label={gt("List saved generator models")}
              icon="text.alignleft"
              disabled={pending || !saved.enabled}
              onPress={() => {
                void run(() => list({ environmentId, input: { id, refresh: true } })).then(
                  (listed) => {
                    if (listed) setModels(listed.models);
                  },
                );
              }}
            />
          ) : null}
          {models && canList && saved.enabled ? (
            models.length > 0 ? (
              <SetupChoice
                label={gt("Test a model")}
                value=""
                options={models.map((model) => ({ value: model.id, label: model.name }))}
                disabled={pending}
                onChange={(model) => {
                  void run(() => list({ environmentId, input: { id, model, test: true } })).then(
                    (tested) => {
                      if (tested?.testedModel) {
                        Dialog.alert(gt("Model answered"), tested.testedModel);
                      }
                    },
                  );
                }}
              />
            ) : (
              <Text className="text-foreground-muted">{gt("No models found.")}</Text>
            )
          ) : null}
          <ListActionRow
            label={gt("Remove text generator")}
            icon="trash"
            tone="danger"
            disabled={pending}
            onPress={() => {
              Dialog.alert(gt("Remove text generator?"), saved.label ?? saved.baseUrl, [
                { text: gt("Cancel"), style: "cancel" },
                { text: gt("Remove"), style: "destructive", onPress: () => void save(id, null) },
              ]);
            }}
          />
        </>
      ) : null}
    </View>
  );
}
