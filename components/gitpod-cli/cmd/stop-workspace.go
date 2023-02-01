// Copyright (c) 2020 Gitpod GmbH. All rights reserved.
// Licensed under the GNU Affero General Public License (AGPL).
// See License.AGPL.txt in the project root for license information.

package cmd

import (
	"context"
	"time"

	"github.com/gitpod-io/gitpod/gitpod-cli/pkg/gitpod"
	"github.com/spf13/cobra"
)

// stopWorkspaceCmd represents the stopWorkspaceCmd command
var stopWorkspaceCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop current workspace",
	Args:  cobra.ArbitraryArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		wsInfo, err := gitpod.GetWSInfo(ctx)
		if err != nil {
			return err
		}
		client, err := gitpod.ConnectToServer(ctx, wsInfo, []string{
			"function:stopWorkspace",
			"resource:workspace::" + wsInfo.WorkspaceId + "::get/update",
		})
		if err != nil {
			return err
		}
		defer client.Close()
		return client.StopWorkspace(ctx, wsInfo.WorkspaceId)
	},
}

func init() {
	rootCmd.AddCommand(stopWorkspaceCmd)
}
