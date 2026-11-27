import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useGT } from "gt-react-native";
import { useRef, useState, type ComponentProps } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { ConnectionFormField } from "../connection/ConnectionFormField";

export function useSetupAction() {
  const gt = useGT();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function run<A>(action: () => Promise<AtomCommandResult<A, unknown>>): Promise<A | null> {
    if (busy.current) return null;
    busy.current = true;
    setPending(true);
    const result = await action().finally(() => {
      busy.current = false;
      setPending(false);
    });
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        gt("Could not complete setup"),
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }
  return { pending, run };
}

export function SetupField(props: ComponentProps<typeof ConnectionFormField>) {
  return <ConnectionFormField autoCapitalize="none" autoCorrect={false} {...props} />;
}

export function SetupChoice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Menu
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      actions={options.map((option) => ({
        id: option.value,
        title: option.label,
        state: option.value === value ? "on" : "off",
        attributes: { disabled },
      }))}
      onPressAction={({ nativeEvent }) => {
        if (!disabled) onChange(nativeEvent.event);
      }}
    >
      <View className="items-start gap-1">
        <Text className="text-sm text-foreground-muted">{label}</Text>
        <ControlPill
          variant="pill"
          label={options.find((option) => option.value === value)?.label ?? (value || label)}
          disabled={disabled}
        />
      </View>
    </Menu>
  );
}
