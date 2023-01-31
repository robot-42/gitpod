// Copyright (c) 2022 Gitpod GmbH. All rights reserved.
// Licensed under the GNU Affero General Public License (AGPL).
// See License-AGPL.txt in the project root for license information.

package controllers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gitpod-io/gitpod/common-go/util"

	"github.com/gitpod-io/gitpod/ws-manager/api/config"
	workspacev1 "github.com/gitpod-io/gitpod/ws-manager/api/crd/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/log"
)

const (
	// containerKilledExitCode is the exit code Kubernetes uses for a container which was killed by the system.
	// We expect such containers to be restarted by Kubernetes if they're supposed to be running.
	// We never deliberately terminate a container like this.
	containerKilledExitCode = 137

	// containerUnknownExitCode is the exit code containerd uses if it cannot determine the cause/exit status of
	// a stopped container.
	containerUnknownExitCode = 255
)

func updateWorkspaceStatus(ctx context.Context, workspace *workspacev1.Workspace, pods corev1.PodList) error {
	log := log.FromContext(ctx)

	switch len(pods.Items) {
	case 0:
		if workspace.Status.Phase == "" {
			workspace.Status.Phase = workspacev1.WorkspacePhasePending
		}

		if workspace.Status.Phase != workspacev1.WorkspacePhasePending {
			workspace.Status.Phase = workspacev1.WorkspacePhaseStopped
		}
		return nil
	case 1:
		// continue below
	default:
		// This is exceptional - not sure what to do here. Probably fail the pod
		workspace.Status.Conditions = AddUniqueCondition(workspace.Status.Conditions, metav1.Condition{
			Type:               string(workspacev1.WorkspaceConditionFailed),
			Status:             metav1.ConditionTrue,
			LastTransitionTime: metav1.Now(),
			Message:            "multiple pods exists - this should never happen",
		})

		return nil
	}

	workspace.Status.Conditions = AddUniqueCondition(workspace.Status.Conditions, metav1.Condition{
		Type:               string(workspacev1.WorkspaceConditionDeployed),
		Status:             metav1.ConditionTrue,
		LastTransitionTime: metav1.Now(),
	})

	pod := &pods.Items[0]

	if workspace.Status.Runtime == nil {
		workspace.Status.Runtime = &workspacev1.WorkspaceRuntimeStatus{}
	}
	if workspace.Status.Runtime.NodeName == "" && pod.Spec.NodeName != "" {
		workspace.Status.Runtime.NodeName = pod.Spec.NodeName
	}
	if workspace.Status.Runtime.HostIP == "" && pod.Status.HostIP != "" {
		workspace.Status.Runtime.HostIP = pod.Status.HostIP
	}
	if workspace.Status.Runtime.PodIP == "" && pod.Status.PodIP != "" {
		workspace.Status.Runtime.PodIP = pod.Status.PodIP
	}
	if workspace.Status.Runtime.PodName == "" && pod.Name != "" {
		workspace.Status.Runtime.PodName = pod.Name
	}

	failure, phase := extractFailure(workspace, pod)
	if phase != nil {
		workspace.Status.Phase = *phase
	}

	if failure != "" && !conditionPresentAndTrue(workspace.Status.Conditions, string(workspacev1.WorkspaceConditionFailed)) {
		// workspaces can fail only once - once there is a failed condition set, stick with it
		workspace.Status.Conditions = AddUniqueCondition(workspace.Status.Conditions, metav1.Condition{
			Type:               string(workspacev1.WorkspaceConditionFailed),
			Status:             metav1.ConditionTrue,
			LastTransitionTime: metav1.Now(),
			Message:            failure,
		})
	}

	switch {
	case isPodBeingDeleted(pod):
		workspace.Status.Phase = workspacev1.WorkspacePhaseStopping

		var hasFinalizer bool
		for _, f := range pod.Finalizers {
			if f == gitpodPodFinalizerName {
				hasFinalizer = true
				break
			}
		}
		if hasFinalizer {
			if conditionPresentAndTrue(workspace.Status.Conditions, string(workspacev1.WorkspaceConditionBackupComplete)) ||
				conditionPresentAndTrue(workspace.Status.Conditions, string(workspacev1.WorkspaceConditionBackupFailure)) ||
				conditionWithStatusAndReson(workspace.Status.Conditions, string(workspacev1.WorkspaceConditionContentReady), false, "InitializationFailure") {

				workspace.Status.Phase = workspacev1.WorkspacePhaseStopped
			}

		} else {
			// We do this independently of the dispostal status because pods only get their finalizer
			// once they're running. If they fail before they reach the running phase we'll never see
			// a disposal status, hence would never stop the workspace.
			workspace.Status.Phase = workspacev1.WorkspacePhaseStopped
		}

	case pod.Status.Phase == corev1.PodPending:
		var creating bool
		// check if any container is still pulling images
		for _, cs := range pod.Status.ContainerStatuses {
			if cs.State.Waiting != nil {
				switch cs.State.Waiting.Reason {
				case "ContainerCreating", "ImagePullBackOff", "ErrImagePull":
					creating = true
				}

				if creating {
					break
				}
			}
		}
		if creating {
			workspace.Status.Phase = workspacev1.WorkspacePhaseCreating
		} else {
			workspace.Status.Phase = workspacev1.WorkspacePhasePending
		}

	case pod.Status.Phase == corev1.PodRunning:
		var ready bool
		for _, cs := range pod.Status.ContainerStatuses {
			if cs.Ready {
				ready = true
				break
			}
		}
		if ready {
			// workspace is ready - hence content init is done
			workspace.Status.Phase = workspacev1.WorkspacePhaseRunning
		} else {
			// workspace has not become ready yet - it must be initializing then.
			workspace.Status.Phase = workspacev1.WorkspacePhaseInitializing
		}

	case workspace.Status.Headless && (pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed):
		workspace.Status.Phase = workspacev1.WorkspacePhaseStopping

	case pod.Status.Phase == corev1.PodUnknown:
		workspace.Status.Phase = workspacev1.WorkspacePhaseUnknown

	default:
		log.Info("cannot determine workspace phase")
		workspace.Status.Phase = workspacev1.WorkspacePhaseUnknown

	}

	return nil
}

// extractFailure returns a pod failure reason and possibly a phase. If phase is nil then
// one should extract the phase themselves. If the pod has not failed, this function returns "", nil.
func extractFailure(ws *workspacev1.Workspace, pod *corev1.Pod) (string, *workspacev1.WorkspacePhase) {
	status := pod.Status
	if status.Phase == corev1.PodFailed && (status.Reason != "" || status.Message != "") {
		// Don't force the phase to UNKNONWN here to leave a chance that we may detect the actual phase of
		// the workspace, e.g. stopping.
		return fmt.Sprintf("%s: %s", status.Reason, status.Message), nil
	}

	for _, cs := range status.ContainerStatuses {
		if cs.State.Waiting != nil {
			if cs.State.Waiting.Reason == "ImagePullBackOff" || cs.State.Waiting.Reason == "ErrImagePull" {
				// If the image pull failed we were definitely in the api.WorkspacePhase_CREATING phase,
				// unless of course this pod has been deleted already.
				var res *workspacev1.WorkspacePhase
				if isPodBeingDeleted(pod) {
					// The pod is being deleted already and we have to decide the phase based on the presence of the
					// finalizer and disposal status annotation. That code already exists in the remainder of getStatus,
					// hence we defer the decision.
					res = nil
				} else {
					c := workspacev1.WorkspacePhaseCreating
					res = &c
				}
				return fmt.Sprintf("cannot pull image: %s", cs.State.Waiting.Message), res
			}
		}

		terminationState := cs.State.Terminated
		if terminationState == nil {
			terminationState = cs.LastTerminationState.Terminated
		}
		if terminationState != nil {
			// a workspace terminated container is not neccesarily bad. During shutdown workspaces containers
			// can go in this state and that's ok. However, if the workspace was shutting down due to deletion,
			// we would not be here as we've checked for a DeletionTimestamp prior. So let's find out why the
			// container is terminating.
			if terminationState.ExitCode != 0 && terminationState.Message != "" {
				var phase workspacev1.WorkspacePhase
				if !isPodBeingDeleted(pod) {
					// If the wrote a termination message and is not currently being deleted,
					// then it must have been/be running. If we did not force the phase here,
					// we'd be in unknown.
					phase = workspacev1.WorkspacePhaseRunning
				}

				// the container itself told us why it was terminated - use that as failure reason
				return extractFailureFromLogs([]byte(terminationState.Message)), &phase
			} else if terminationState.Reason == "Error" {
				if !isPodBeingDeleted(pod) && terminationState.ExitCode != containerKilledExitCode {
					phase := workspacev1.WorkspacePhaseRunning
					return fmt.Sprintf("container %s ran with an error: exit code %d", cs.Name, terminationState.ExitCode), &phase
				}
			} else if terminationState.Reason == "Completed" && !isPodBeingDeleted(pod) {
				if ws.Status.Headless {
					// headless workspaces are expected to finish
					return "", nil
				}
				return fmt.Sprintf("container %s completed; containers of a workspace pod are not supposed to do that", cs.Name), nil
			} else if !isPodBeingDeleted(pod) && terminationState.ExitCode != containerUnknownExitCode {
				// if a container is terminated and it wasn't because of either:
				//  - regular shutdown
				//  - the exit code "UNKNOWN" (which might be caused by an intermittent issue and is handled in extractStatusFromPod)
				//  - another known error
				// then we report it as UNKNOWN
				phase := workspacev1.WorkspacePhaseUnknown
				return fmt.Sprintf("workspace container %s terminated for an unknown reason: (%s) %s", cs.Name, terminationState.Reason, terminationState.Message), &phase
			}
		}
	}

	return "", nil
}

// extractFailureFromLogs attempts to extract the last error message from a workspace
// container's log output.
func extractFailureFromLogs(logs []byte) string {
	var sep = []byte("\n")
	var msg struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}

	var nidx int
	for idx := bytes.LastIndex(logs, sep); idx > 0; idx = nidx {
		nidx = bytes.LastIndex(logs[:idx], sep)
		if nidx < 0 {
			nidx = 0
		}

		line := logs[nidx:idx]
		err := json.Unmarshal(line, &msg)
		if err != nil {
			continue
		}

		if msg.Message == "" {
			continue
		}

		if msg.Error == "" {
			return msg.Message
		}

		return msg.Message + ": " + msg.Error
	}

	return string(logs)
}

// isPodBeingDeleted returns true if the pod is currently being deleted
func isPodBeingDeleted(pod *corev1.Pod) bool {
	// if the pod is being deleted the only marker we have is that the deletionTimestamp is set
	return pod.ObjectMeta.DeletionTimestamp != nil
}

type activity string

const (
	activityInit               activity = "initialization"
	activityStartup            activity = "startup"
	activityCreatingContainers activity = "creating containers"
	activityPullingImages      activity = "pulling images"
	activityRunningHeadless    activity = "running the headless workspace"
	activityNone               activity = "period of inactivity"
	activityMaxLifetime        activity = "maximum lifetime"
	activityClosed             activity = "after being closed"
	activityInterrupted        activity = "workspace interruption"
	activityStopping           activity = "stopping"
	activityBackup             activity = "backup"
)

// isWorkspaceTimedOut determines if a workspace is timed out based on the manager configuration and state the pod is in.
// This function does NOT use the workspaceTimedoutAnnotation, but rather is used to set that annotation in the first place.
func isWorkspaceTimedOut(ws *workspacev1.Workspace, pod *corev1.Pod, timeouts config.WorkspaceTimeoutConfiguration) (reason string, err error) {
	// workspaceID := ws.Spec.Ownership.WorkspaceID
	phase := ws.Status.Phase

	decide := func(start time.Time, timeout util.Duration, activity activity) (string, error) {
		td := time.Duration(timeout)
		inactivity := time.Since(start)
		if inactivity < td {
			return "", nil
		}

		return fmt.Sprintf("workspace timed out after %s (%s) took longer than %s", activity, formatDuration(inactivity), formatDuration(td)), nil
	}

	// TODO: Use ws or pod's CreationTimestamp?
	start := ws.ObjectMeta.CreationTimestamp.Time
	lastActivity := getWorkspaceActivity(ws)
	isClosed := conditionPresentAndTrue(ws.Status.Conditions, string(workspacev1.WorkspaceConditionClosed))

	switch phase {
	case workspacev1.WorkspacePhasePending:
		return decide(start, timeouts.Initialization, activityInit)

	case workspacev1.WorkspacePhaseInitializing:
		return decide(start, timeouts.TotalStartup, activityStartup)

	case workspacev1.WorkspacePhaseCreating:
		activity := activityCreatingContainers
		// TODO:
		// if status.Conditions.PullingImages == api.WorkspaceConditionBool_TRUE {
		// 	activity = activityPullingImages
		// }
		return decide(start, timeouts.TotalStartup, activity)

	case workspacev1.WorkspacePhaseRunning:
		// First check is always for the max lifetime
		if msg, err := decide(start, timeouts.MaxLifetime, activityMaxLifetime); msg != "" {
			return msg, err
		}

		timeout := timeouts.RegularWorkspace
		activity := activityNone
		if ws.Status.Headless {
			timeout = timeouts.HeadlessWorkspace
			lastActivity = &start
			activity = activityRunningHeadless
		} else if lastActivity == nil {
			// the workspace is up and running, but the user has never produced any activity
			return decide(start, timeouts.TotalStartup, activityNone)
		} else if isClosed {
			return decide(*lastActivity, timeouts.AfterClose, activityClosed)
		}
		if ctv := ws.Spec.Timeout.Time; ctv != nil {
			timeout = util.Duration(ctv.Duration)
		}
		return decide(*lastActivity, timeout, activity)

	case workspacev1.WorkspacePhaseStopping:
		if isPodBeingDeleted(pod) && conditionPresentAndTrue(ws.Status.Conditions, string(workspacev1.WorkspaceConditionBackupComplete)) {
			// Beware: we apply the ContentFinalization timeout only to workspaces which are currently being deleted.
			//         We basically don't expect a workspace to be in content finalization before it's been deleted.
			return decide(pod.DeletionTimestamp.Time, timeouts.ContentFinalization, activityBackup)
		} else if !isPodBeingDeleted(pod) {
			// pods that have not been deleted have never timed out
			return "", nil
		} else {
			return decide(pod.DeletionTimestamp.Time, timeouts.Stopping, activityStopping)
		}

	default:
		// the only other phases we can be in is stopped which is pointless to time out
		return "", nil
	}
}

func getWorkspaceActivity(ws *workspacev1.Workspace) *time.Time {
	for _, c := range ws.Status.Conditions {
		if c.Type == string(workspacev1.WorkspaceConditionUserActivity) {
			return &c.LastTransitionTime.Time
		}
	}
	return nil
}

func formatDuration(d time.Duration) string {
	d = d.Round(time.Minute)
	h := d / time.Hour
	d -= h * time.Hour
	m := d / time.Minute
	return fmt.Sprintf("%02dh%02dm", h, m)
}
