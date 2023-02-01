// Copyright (c) 2020 Gitpod GmbH. All rights reserved.
// Licensed under the GNU Affero General Public License (AGPL).
// See License.AGPL.txt in the project root for license information.

package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/gitpod-io/gitpod/gitpod-cli/pkg/supervisor"

	"context"

	"github.com/google/shlex"
	"github.com/spf13/cobra"
	"golang.org/x/sys/unix"
)

// initCmd represents the init command
var openCmd = &cobra.Command{
	Use:   "open <filename>",
	Short: "Opens a file in Gitpod",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		// TODO(ak) use NotificationService.NotifyActive supervisor API instead

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		client, err := supervisor.New(ctx)
		if err != nil {
			return err
		}
		defer client.Close()

		client.WaitForIDEReady(ctx)

		wait, _ := cmd.Flags().GetBool("wait")

		pcmd := os.Getenv("GP_OPEN_EDITOR")
		if pcmd == "" {
			return fmt.Errorf("GP_OPEN_EDITOR is not set")
		}
		pargs, err := shlex.Split(pcmd)
		if err != nil {
			return fmt.Errorf("cannot parse GP_OPEN_EDITOR: %v", err)
		}
		if len(pargs) > 1 {
			pcmd = pargs[0]
		}
		pcmd, err = exec.LookPath(pcmd)
		if err != nil {
			return err
		}

		if wait {
			pargs = append(pargs, "--wait")
		}

		return unix.Exec(pcmd, append(pargs, args...), os.Environ())
	},
}

func init() {
	rootCmd.AddCommand(openCmd)
	openCmd.Flags().BoolP("wait", "w", false, "wait until all opened files are closed again")
}
