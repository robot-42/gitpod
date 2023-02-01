// Copyright (c) 2023 Gitpod GmbH. All rights reserved.
// Licensed under the GNU Affero General Public License (AGPL).
// See License.AGPL.txt in the project root for license information.

package cmd

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/gitpod-io/gitpod/gitpod-cli/pkg/gitpod"
	"github.com/gitpod-io/gitpod/gitpod-cli/pkg/utils"
	"github.com/spf13/cobra"
)

var sendAnalyticsCmdOpts struct {
	data string
}

// sendAnalyticsCmd represents the send-analytics command
var sendAnalyticsCmd = &cobra.Command{
	Use:    "send-analytics",
	Long:   "Sending anonymous statistics about the gp commands executed inside a workspace",
	Hidden: true,
	Args:   cobra.ExactArgs(0),
	RunE: func(cmd *cobra.Command, args []string) error {
		defer os.Exit(0)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// // test
		// os.WriteFile(os.TempDir()+"/gitpod-send-analytics.log", []byte(sendAnalyticsCmdOpts.data), 0644)
		// return

		var data utils.TrackCommandUsageParams
		err := json.Unmarshal([]byte(sendAnalyticsCmdOpts.data), &data)
		if err != nil {
			log.Fatal(err)
		}

		wsInfo, err := gitpod.GetWSInfo(ctx)
		if err != nil {
			log.Fatal(err)
		}
		data.InstanceId = wsInfo.InstanceId
		data.WorkspaceId = wsInfo.WorkspaceId

		event := utils.NewAnalyticsEvent(wsInfo.OwnerId)
		event.Data = &data

		err = event.Send(ctx)
		if err != nil {
			utils.LogError(err, "", wsInfo)
			return nil
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(sendAnalyticsCmd)

	sendAnalyticsCmd.Flags().StringVarP(&sendAnalyticsCmdOpts.data, "data", "", "", "JSON encoded event data")
	sendAnalyticsCmd.MarkFlagRequired("data")
}
