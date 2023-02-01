// Copyright (c) 2022 Gitpod GmbH. All rights reserved.
// Licensed under the GNU Affero General Public License (AGPL).
// See License-AGPL.txt in the project root for license information.

package controllers

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	wsactivity "github.com/gitpod-io/gitpod/ws-manager-mk2/pkg/activity"
	config "github.com/gitpod-io/gitpod/ws-manager/api/config"
	workspacev1 "github.com/gitpod-io/gitpod/ws-manager/api/crd/v1"
)

func NewTimeoutReconciler(c client.Client, cfg config.Configuration, activity *wsactivity.WorkspaceActivity) (*TimeoutReconciler, error) {
	reconcileInterval := time.Duration(cfg.HeartbeatInterval)
	// Reconcile interval is half the heartbeat interval to catch timed out workspaces in time.
	// See https://en.wikipedia.org/wiki/Nyquist%E2%80%93Shannon_sampling_theorem why we need this.
	reconcileInterval /= 2

	return &TimeoutReconciler{
		Client:            c,
		Config:            cfg,
		activity:          activity,
		reconcileInterval: reconcileInterval,
	}, nil
}

// TimeoutReconciler reconciles workspace timeouts.
type TimeoutReconciler struct {
	client.Client

	Config            config.Configuration
	activity          *wsactivity.WorkspaceActivity
	reconcileInterval time.Duration
}

//+kubebuilder:rbac:groups=workspace.gitpod.io,resources=workspaces,verbs=get;list;watch;create;update;patch;delete
//+kubebuilder:rbac:groups=workspace.gitpod.io,resources=workspaces/status,verbs=get;update;patch

// Reconcile will check the given workspace for timing out. When done, a new event gets
// requeued automatically to ensure the workspace gets reconciled at least every reconcileInterval.
func (r *TimeoutReconciler) Reconcile(ctx context.Context, req ctrl.Request) (result ctrl.Result, err error) {
	log := log.FromContext(ctx).WithValues("ws", req.NamespacedName)
	// TODO(wouter): Make debug log:
	log.Info("reconciling workspace timeout")

	var workspace workspacev1.Workspace
	if err := r.Get(ctx, req.NamespacedName, &workspace); err != nil {
		log.Error(err, "unable to fetch workspace")
		// we'll ignore not-found errors, since they can't be fixed by an immediate
		// requeue (we'll need to wait for a new notification), and we can get them
		// on deleted requests.
		// On any other error, let the controller requeue an event with exponential
		// backoff.
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	// There was no error getting the workspace, so it exists. After this point, we
	// always want to reconcile again after the configured interval.
	defer func() {
		result.RequeueAfter = r.reconcileInterval
	}()

	timedout, err := isWorkspaceTimedOut(&workspace, r.Config.Timeouts, r.activity)
	if err != nil {
		log.Error(err, "failed to check for workspace timeout")
		return ctrl.Result{}, err
	}

	if timedout == "" {
		// Hasn't timed out.
		return ctrl.Result{}, nil
	}

	// Workspace timed out, set Timeout condition.
	if conditionPresentAndTrue(workspace.Status.Conditions, string(workspacev1.WorkspaceConditionTimeout)) {
		// Already has Timeout condition, don't update.
		return ctrl.Result{}, nil
	}

	log.Info("Workspace timed out", "reason", timedout, "timeout", workspace.Spec.Timeout)
	workspace.Status.Conditions = AddUniqueCondition(workspace.Status.Conditions, metav1.Condition{
		Type:               string(workspacev1.WorkspaceConditionTimeout),
		Status:             metav1.ConditionTrue,
		LastTransitionTime: metav1.Now(),
		Message:            timedout,
	})

	err = r.Client.Status().Update(ctx, &workspace)
	return ctrl.Result{}, err
}

// SetupWithManager sets up the controller with the Manager.
func (r *TimeoutReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&workspacev1.Workspace{}).
		Complete(r)
}
