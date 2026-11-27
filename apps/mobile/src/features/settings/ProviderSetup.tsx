import { useAtomValue } from "@effect/atom-react";
import { providerClients } from "@t3tools/client-runtime/provider-clients";
import {
  deriveAvailableInstanceId,
  deriveInstanceId,
} from "@t3tools/client-runtime/provider-instance-ids";
import {
  ACP_REGISTRY_SEARCH_QUERY_MAX_LENGTH,
  AuthOrchestrationReadScope,
  AuthProvidersManageScope,
  defaultInstanceIdForDriver,
  isManagedDriverAllowed,
  isSecretSetting,
  ProviderDriverKind,
  ProviderInstanceId,
  resolveOfficialAcpRegistryIconUrl,
  resolveProviderInstanceEnabled,
  type AcpRegistrySearchAgent,
  type ProviderInstanceConfig,
  type ProviderInstanceMutation,
  type ProviderSettingsFormAnnotation,
  type ServerProvider,
} from "@t3tools/contracts";
import { readCustomModelEntries, toCustomModelSetting } from "@t3tools/shared/model";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { Menu } from "../../components/ui/Menu";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import type { SettingsTarget } from "./settings-environment-filter";
import { SetupChoice, SetupField, useSetupAction } from "./ProviderSetupControls";
import { TextGeneratorSetup } from "./TextGeneratorSetup";

const ACP_REGISTRY = ProviderDriverKind.make("acpRegistry");
const BUILT_IN_REGISTRY_AGENTS = new Set(
  providerClients.definitions.flatMap((driver) => driver.acpRegistryAgentIds ?? []),
);

export function ProviderSetup({
  environment,
  providers,
}: {
  readonly environment: SettingsTarget;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const gt = useGT();
  const { environmentId } = environment;
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const canPrepare = useAtomValue(
    serverEnvironment.prepareAcpRegistryAgent.permissionAtom(environmentId),
  );
  const canUninstall = useAtomValue(
    serverEnvironment.uninstallAcpRegistryManagedBinary.permissionAtom(environmentId),
  );
  const prepare = useAtomCommand(serverEnvironment.prepareAcpRegistryAgent, {
    reportFailure: false,
  });
  const uninstall = useAtomCommand(serverEnvironment.uninstallAcpRegistryManagedBinary, {
    reportFailure: false,
  });
  const mutate = useAtomCommand(serverEnvironment.mutateProviderInstance, { reportFailure: false });
  const { pending, run } = useSetupAction();
  const [open, setOpen] = useState<ProviderInstanceId | "browseRegistry" | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const registry = useEnvironmentQuery(
    open === "browseRegistry" && canRead && canPrepare
      ? serverEnvironment.searchAcpRegistry({ environmentId, input: { query, limit: 24 } })
      : null,
  );
  if (!settings) return null;

  const policy = environment.serverConfig.managedPolicy;
  const drivers = providerClients.definitions.filter(
    (driver) =>
      driver.driverKind !== ACP_REGISTRY && isManagedDriverAllowed(policy, driver.driverKind),
  );
  const canBrowse = canRead && canPrepare && isManagedDriverAllowed(policy, ACP_REGISTRY);
  const addActions = [
    ...drivers.map((driver) => ({ id: driver.driverKind, title: driver.label })),
    ...(canBrowse ? [{ id: "registry", title: gt("ACP Registry") }] : []),
  ];

  function save(mutation: ProviderInstanceMutation) {
    return mutate({ environmentId, input: { patch: {}, providerInstanceMutation: mutation } });
  }

  async function add(driver: ProviderDriverKind, label: string, agent?: AcpRegistrySearchAgent) {
    if (
      !settings ||
      !readEnvironmentScope(environmentId, AuthProvidersManageScope) ||
      !isManagedDriverAllowed(policy, driver)
    )
      return;
    const existing = new Set([
      ...providers.map((provider) => provider.instanceId),
      ...Object.keys(settings.providerInstances ?? {}),
      ...Object.keys(settings.textGenerators),
    ]);
    const rawId = deriveAvailableInstanceId(
      (name) =>
        agent ? deriveInstanceId(driver, name) || deriveInstanceId(driver, agent.id) : driver,
      label,
      existing,
    );
    const instanceId = ProviderInstanceId.make(rawId);
    const iconUrl = resolveOfficialAcpRegistryIconUrl(agent?.icon);
    const result = await run<unknown>(async () => {
      if (agent) {
        const prepared = await prepare({ environmentId, input: { agentId: agent.id } });
        if (prepared._tag === "Failure") return prepared;
      }
      return save({
        operation: "create",
        instanceId,
        instance: {
          driver,
          displayName: label,
          enabled: true,
          ...(agent
            ? { config: { agentId: agent.id, ...(iconUrl ? { registryIconUrl: iconUrl } : {}) } }
            : driver === "codex"
              ? { config: { setupMode: "existing" } }
              : {}),
        },
      });
    });
    if (result) setOpen(instanceId);
  }

  function remove(instanceId: ProviderInstanceId, instance: ProviderInstanceConfig) {
    const reset = instanceId === defaultInstanceIdForDriver(instance.driver);
    const title = reset ? gt("Reset provider settings?") : gt("Remove provider?");
    Dialog.alert(
      title,
      gt("This can stop threads that use this provider. Thread history is kept."),
      [
        { text: gt("Cancel"), style: "cancel" },
        {
          text: reset ? gt("Reset") : gt("Remove"),
          style: "destructive",
          onPress: () => {
            if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
            void run<unknown>(async () => {
              const removed = await save({ operation: "remove", instanceId });
              if (removed._tag === "Success") {
                setOpen(null);
                const config = instance.config as { source?: string; agentId?: string } | undefined;
                if (
                  canUninstall &&
                  instance.driver === ACP_REGISTRY &&
                  config?.source !== "local" &&
                  config?.agentId
                ) {
                  const result = await uninstall({
                    environmentId,
                    input: { agentId: config.agentId },
                  });
                  if (result._tag === "Failure") return result;
                }
              }
              return removed;
            });
          },
        },
      ],
    );
  }

  return (
    <>
      {providers.map((provider) => {
        const { instanceId } = provider;
        const stored = settings.providerInstances?.[instanceId];
        const instance = stored ?? { driver: provider.driver, enabled: provider.enabled };
        return (
          <View key={instanceId} className="border-t border-border-subtle">
            <ListActionRow
              label={gt("Set up {provider}", { provider: provider.displayName ?? provider.driver })}
              description={!provider.installed ? gt("Not installed") : undefined}
              icon="gearshape"
              onPress={() => setOpen(open === instanceId ? null : instanceId)}
            />
            {open === instanceId ? (
              <ProviderConfiguration
                environment={environment}
                provider={provider}
                instance={instance}
                pending={pending}
                onSave={async (next) =>
                  readEnvironmentScope(environmentId, AuthProvidersManageScope) &&
                  Boolean(
                    await run(() => save({ operation: "upsert", instanceId, instance: next })),
                  )
                }
                onRemove={stored ? () => remove(instanceId, stored) : undefined}
              />
            ) : null}
          </View>
        );
      })}
      {addActions.length > 0 ? (
        <Menu
          accessible
          accessibilityRole="button"
          accessibilityLabel={gt("Add provider")}
          actions={addActions}
          onPressAction={({ nativeEvent }) => {
            if (pending) return;
            if (nativeEvent.event === "registry" && canBrowse) {
              setOpen(open === "browseRegistry" ? null : "browseRegistry");
              return;
            }
            const driver = drivers.find((entry) => entry.driverKind === nativeEvent.event);
            if (driver) void add(driver.driverKind, driver.label);
          }}
        >
          <View className="items-start px-4 py-2">
            <ControlPill variant="pill" icon="plus" label={gt("Add provider")} disabled={pending} />
          </View>
        </Menu>
      ) : null}
      {open === "browseRegistry" && canBrowse ? (
        <View className="gap-2 border-t border-border-subtle px-4 py-3">
          <SetupField
            label={gt("Search ACP Registry")}
            value={search}
            maxLength={ACP_REGISTRY_SEARCH_QUERY_MAX_LENGTH}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={() => {
              const next = search.trim();
              if (next === query) registry.refresh();
              else setQuery(next);
            }}
          />
          {registry.isPending ? (
            <Text className="text-foreground-muted">{gt("Loading…")}</Text>
          ) : null}
          {registry.error ? <Text className="text-danger">{registry.error}</Text> : null}
          {registry.data?.agents.length === 0 ? (
            <Text className="text-foreground-muted">{gt("No agents found.")}</Text>
          ) : null}
          {registry.data?.agents
            .filter((agent) => !BUILT_IN_REGISTRY_AGENTS.has(agent.id))
            .map((agent) => (
              <ListActionRow
                key={agent.id}
                label={agent.name}
                description={agent.description || agent.id}
                icon="plus"
                disabled={pending}
                onPress={() => {
                  Dialog.alert(
                    gt("Install {provider}?", { provider: agent.name }),
                    gt("This downloads and runs the agent on {environment}.", {
                      environment: environment.label,
                    }),
                    [
                      { text: gt("Cancel"), style: "cancel" },
                      {
                        text: gt("Install"),
                        onPress: () => void add(ACP_REGISTRY, agent.name, agent),
                      },
                    ],
                  );
                }}
              />
            ))}
        </View>
      ) : null}
      <TextGeneratorSetup environment={environment} settings={settings} providers={providers} />
    </>
  );
}

function ProviderConfiguration({
  environment,
  provider,
  instance,
  pending,
  onSave,
  onRemove,
}: {
  readonly environment: SettingsTarget;
  readonly provider: ServerProvider;
  readonly instance: ProviderInstanceConfig;
  readonly pending: boolean;
  readonly onSave: (instance: ProviderInstanceConfig) => Promise<boolean>;
  readonly onRemove: (() => void) | undefined;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [name, setName] = useState<string | null>(null);
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const definition = providerClients.get(provider.driver);
  const stored = instance.config;
  const config = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const models = readCustomModelEntries(config.customModels);
  const schema = definition?.settingsSchema;
  const order =
    Schema.resolveAnnotations(schema ?? Schema.Unknown)?.providerSettingsFormSchema?.order ?? [];
  const position = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  const fields = Object.entries(schema?.fields ?? {}).sort(
    ([left], [right]) => position(left) - position(right),
  );
  const locked =
    environment.serverConfig.managedPolicy?.limits?.providers?.lockedInstanceFields?.[
      provider.driver
    ];
  const nextModel = modelId.trim();

  const saveModels = (next: typeof models) =>
    onSave({ ...instance, config: { ...config, customModels: next.map(toCustomModelSetting) } });

  return (
    <View className="gap-2 px-4 pb-4">
      <ProviderInstallation environment={environment} provider={provider} />
      <SettingsSwitchRow
        label={gt("Enabled")}
        value={resolveProviderInstanceEnabled(instance)}
        disabled={pending}
        onValueChange={(enabled) => void onSave({ ...instance, enabled })}
      />
      <SetupField
        label={gt("Display name")}
        value={name ?? instance.displayName ?? ""}
        editable={!pending}
        onChangeText={setName}
      />
      {fields.map(([key, field]) => {
        const annotations = Schema.resolveAnnotationsKey(field) ?? Schema.resolveAnnotations(field);
        const codexSetup = key === "setupMode" && provider.driver === "codex";
        const form: ProviderSettingsFormAnnotation = codexSetup
          ? {
              options: [
                { value: "existing", label: gt("Use existing CLI") },
                { value: "managed", label: gt("Managed runtime") },
              ],
            }
          : (annotations?.providerSettingsForm ?? {});
        const controller = form?.visibleWhen;
        const controllerField = controller && definition?.settingsSchema.fields[controller.field];
        const defaultOption =
          controllerField &&
          Schema.resolveAnnotationsKey(controllerField)?.providerSettingsForm?.options?.[0]?.value;
        const current =
          controller && (draft[controller.field] ?? config[controller.field] ?? defaultOption);
        if (
          form.hidden ||
          (!codexSetup && typeof annotations?.title !== "string") ||
          (controller && !controller.values.some((value) => value === current))
        )
          return null;
        const label = codexSetup
          ? gt("Setup mode")
          : typeof annotations?.title === "string"
            ? annotations.title
            : key;
        const value = draft[key] ?? config[key];
        const editable = !pending && !locked?.includes(`config.${key}`);
        if (form.control === "switch") {
          const initial = Schema.decodeOption(field as Schema.Decoder<unknown>)(undefined);
          return (
            <SettingsSwitchRow
              key={key}
              label={label}
              value={value === undefined ? Option.getOrUndefined(initial) === true : value === true}
              disabled={!editable}
              onValueChange={(next) => setDraft({ ...draft, [key]: next })}
            />
          );
        }
        if (form.options) {
          return (
            <SetupChoice
              key={key}
              label={label}
              value={typeof value === "string" ? value : (form.options[0]?.value ?? "")}
              options={form.options}
              disabled={!editable}
              onChange={(next) => setDraft({ ...draft, [key]: next })}
            />
          );
        }
        const secret = isSecretSetting(field);
        return (
          <SetupField
            key={key}
            label={label}
            placeholder={secret && config[key] ? gt("Credential saved") : form.placeholder}
            secureTextEntry={secret}
            value={
              typeof draft[key] === "string"
                ? draft[key]
                : !secret && typeof value === "string"
                  ? value
                  : ""
            }
            editable={editable}
            onChangeText={(next) => setDraft({ ...draft, [key]: next })}
          />
        );
      })}
      <ListActionRow
        label={gt("Save configuration")}
        icon="checkmark"
        loading={pending}
        disabled={name === null && Object.keys(draft).length === 0}
        onPress={() => {
          const next = { ...config };
          for (const [key, value] of Object.entries(draft)) {
            const field = definition?.settingsSchema.fields[key];
            const empty = typeof value === "string" && !value.trim();
            if (locked?.includes(`config.${key}`)) continue;
            if (empty && field && isSecretSetting(field)) continue;
            if (
              empty &&
              field &&
              Schema.resolveAnnotationsKey(field)?.providerSettingsForm?.clearWhenEmpty !==
                "persist"
            )
              delete next[key];
            else {
              const normalized = typeof value === "string" ? value.trim() : value;
              if (
                field &&
                Option.isNone(Schema.decodeOption(field as Schema.Decoder<unknown>)(normalized))
              ) {
                const label = Schema.resolveAnnotationsKey(field)?.title;
                Dialog.alert(
                  gt("Invalid provider setting"),
                  typeof label === "string" ? label : key,
                );
                return;
              }
              next[key] = normalized;
            }
          }
          const { displayName, ...rest } = instance;
          const nextName = name === null ? displayName : name.trim();
          void onSave({
            ...rest,
            ...(Object.keys(draft).length > 0 ? { config: next } : {}),
            ...(nextName ? { displayName: nextName } : {}),
          }).then((saved) => {
            if (saved) {
              setDraft({});
              setName(null);
            }
          });
        }}
      />
      {provider.driver !== "antigravity" && definition?.settingsSchema.fields.customModels ? (
        <>
          {models.map((model) => (
            <ListActionRow
              key={model.slug}
              label={model.name}
              description={model.slug}
              icon="pencil"
              disabled={pending}
              onPress={() => {
                setEditingModel(model.slug);
                setModelId(model.slug);
                setModelName(model.name);
              }}
            />
          ))}
          <SetupField
            label={gt("Custom model ID")}
            value={modelId}
            onChangeText={setModelId}
            editable={!pending && editingModel === null}
          />
          <SetupField
            label={gt("Model name")}
            value={modelName}
            onChangeText={setModelName}
            editable={!pending}
          />
          {editingModel ? (
            <ListActionRow
              label={gt("Remove custom model")}
              icon="trash"
              tone="danger"
              disabled={pending}
              onPress={() => {
                void saveModels(models.filter((entry) => entry.slug !== editingModel)).then(
                  (saved) => {
                    if (saved) {
                      setEditingModel(null);
                      setModelId("");
                      setModelName("");
                    }
                  },
                );
              }}
            />
          ) : null}
          <ListActionRow
            label={editingModel ? gt("Save custom model") : gt("Add custom model")}
            icon={editingModel ? "checkmark" : "plus"}
            disabled={
              pending ||
              !nextModel ||
              (!editingModel &&
                (models.some((model) => model.slug === nextModel) ||
                  provider.models.some((model) => model.slug === nextModel)))
            }
            onPress={() => {
              const name = modelName.trim() || nextModel;
              const next = editingModel
                ? models.map((model) => (model.slug === editingModel ? { ...model, name } : model))
                : [...models, { slug: nextModel, name, capabilities: null }];
              void saveModels(next).then((saved) => {
                if (saved) {
                  setEditingModel(null);
                  setModelId("");
                  setModelName("");
                }
              });
            }}
          />
          {editingModel ? (
            <ListActionRow
              label={gt("Cancel")}
              icon="xmark"
              disabled={pending}
              onPress={() => {
                setEditingModel(null);
                setModelId("");
                setModelName("");
              }}
            />
          ) : null}
        </>
      ) : null}
      {onRemove ? (
        <ListActionRow
          label={
            provider.instanceId === defaultInstanceIdForDriver(provider.driver)
              ? gt("Reset provider settings")
              : gt("Remove provider")
          }
          icon="trash"
          tone="danger"
          disabled={pending}
          onPress={onRemove}
        />
      ) : null}
    </View>
  );
}

function ProviderInstallation({
  environment,
  provider,
}: {
  readonly environment: SettingsTarget;
  readonly provider: ServerProvider;
}) {
  const gt = useGT();
  const { environmentId } = environment;
  const target = { environmentId, input: { instanceId: provider.instanceId } };
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const canInstall = useAtomValue(
    serverEnvironment.startProviderInstall.permissionAtom(environmentId),
  );
  const canCancel = useAtomValue(
    serverEnvironment.cancelProviderInstall.permissionAtom(environmentId),
  );
  const canRemove = useAtomValue(
    serverEnvironment.removeProviderInstallation.permissionAtom(environmentId),
  );
  const start = useAtomCommand(serverEnvironment.startProviderInstall, { reportFailure: false });
  const cancel = useAtomCommand(serverEnvironment.cancelProviderInstall, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.removeProviderInstallation, {
    reportFailure: false,
  });
  const install = useEnvironmentQuery(
    provider.setup?.canInstall && canRead ? serverEnvironment.providerInstallState(target) : null,
  );
  const auth = useEnvironmentQuery(
    provider.setup?.canInstall && canRead ? serverEnvironment.providerAuthState(target) : null,
  );
  const { pending, run } = useSetupAction();
  const state = install.data;
  const active =
    state?.phase === "downloading" || state?.phase === "extracting" || state?.phase === "verifying";
  const authenticating =
    auth.data?.phase === "starting" ||
    auth.data?.phase === "waiting" ||
    auth.data?.phase === "verifying";
  const operationId = state?.operationId;
  if (!provider.setup?.canInstall) {
    return !provider.installed && provider.driver !== ACP_REGISTRY ? (
      <Text className="text-foreground-muted">
        {gt("Automatic installation is unavailable on this environment.")}
      </Text>
    ) : null;
  }
  if (!canRead) return null;

  return (
    <>
      {state?.message || install.error ? (
        <Text className="text-foreground-muted">{install.error ?? state?.message}</Text>
      ) : null}
      {active && operationId && canCancel ? (
        <ListActionRow
          label={gt("Cancel installation")}
          icon="xmark"
          loading={pending}
          onPress={() =>
            void run(() => cancel({ ...target, input: { ...target.input, operationId } }))
          }
        />
      ) : !active && canInstall ? (
        <ListActionRow
          label={state?.installedVersion ? gt("Reinstall provider") : gt("Install provider")}
          icon="arrow.down.circle"
          disabled={!state || authenticating || !!install.error}
          loading={pending}
          onPress={() => void run(() => start(target))}
        />
      ) : null}
      {canRemove && state?.canRemove && !active ? (
        <ListActionRow
          label={gt("Remove managed installation")}
          icon="trash"
          tone="danger"
          disabled={pending || authenticating}
          onPress={() => {
            Dialog.alert(
              gt("Remove managed installation?"),
              gt("This removes the executable from this environment."),
              [
                { text: gt("Cancel"), style: "cancel" },
                {
                  text: gt("Remove"),
                  style: "destructive",
                  onPress: () => void run(() => remove(target)),
                },
              ],
            );
          }}
        />
      ) : null}
    </>
  );
}
