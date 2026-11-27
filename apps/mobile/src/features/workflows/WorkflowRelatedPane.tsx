import { CommonActions, useNavigation } from "@react-navigation/native";

import { IssueRouteScreen } from "../issues/IssueRouteScreen";
import type { IssueParams } from "../issues/issueParams";
import { Inspector } from "../layout/AdaptiveWorkspaceLayout";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/adaptive-workspace-context";
import { PullRequestRouteScreen } from "../pull-requests/PullRequestRouteScreen";
import type { PullRequestParams } from "../pull-requests/usePullRequestDiff";
import { ThreadRouteScreen } from "../threads/ThreadRouteScreen";
import type { ThreadInspectorTarget } from "../threads/thread-inspector-navigation";
import { InspectorContentScope, ThreadInspectorPreview } from "../threads/thread-inspector-preview";

export type WorkflowRelatedTarget =
  | { readonly kind: "thread"; readonly target: ThreadInspectorTarget }
  | { readonly kind: "issue"; readonly params: IssueParams }
  | { readonly kind: "pullRequest"; readonly params: PullRequestParams };

export function useOpenWorkflowRelated(run: {
  readonly environmentId: string;
  readonly runId: string;
}) {
  const navigation = useNavigation();
  const { fileInspector } = useWorkspacePaneState();
  const { showInspector } = useAdaptiveWorkspaceLayout();
  return (related: WorkflowRelatedTarget): boolean => {
    if (!fileInspector.supported) return false;
    const state = navigation.getState();
    if (!state) return false;
    const route = state.routes.slice(0, state.index + 1).findLast((route) => {
      if (route.name !== "WorkflowRun") return false;
      const params = route.params as { environmentId?: string; runId?: string } | undefined;
      return params?.environmentId === run.environmentId && params.runId === run.runId;
    });
    if (!route) return false;
    navigation.dispatch({
      ...CommonActions.setParams({ related }),
      source: route.key,
      target: state.key,
    });
    if (state.routes[state.index]?.name === "WorkflowStep") navigation.goBack();
    showInspector();
    return true;
  };
}

export function WorkflowRelatedPane(props: { readonly related: WorkflowRelatedTarget }) {
  const navigation = useNavigation();
  const { fileInspector } = useWorkspacePaneState();
  const { toggleAuxiliaryPane } = useAdaptiveWorkspaceLayout();
  if (!fileInspector.supported) return null;
  const { related } = props;
  const render = () => {
    switch (related.kind) {
      case "thread":
        return (
          <ThreadInspectorPreview
            target={related.target}
            onClose={toggleAuxiliaryPane}
            onOpen={(target) => navigation.setParams({ related: { kind: "thread", target } })}
            renderThread={(screen) => <ThreadRouteScreen {...screen} />}
          />
        );
      case "issue":
        return (
          <InspectorContentScope>
            <IssueRouteScreen route={{ params: related.params }} />
          </InspectorContentScope>
        );
      case "pullRequest":
        return (
          <InspectorContentScope>
            <PullRequestRouteScreen route={{ params: related.params }} />
          </InspectorContentScope>
        );
    }
  };
  const key = JSON.stringify(related);
  return <Inspector content={{ active: key, panes: [{ key, render }] }} revealKey={key} />;
}
