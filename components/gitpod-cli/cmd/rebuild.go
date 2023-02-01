// Copyright (c) 2023 Gitpod GmbH. All rights reserved.
// Licensed under the GNU Affero General Public License (AGPL).
// See License.AGPL.txt in the project root for license information.

package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gitpod-io/gitpod/gitpod-cli/pkg/gitpod"
	"github.com/gitpod-io/gitpod/gitpod-cli/pkg/utils"
	"github.com/gitpod-io/gitpod/supervisor/api"
	"github.com/spf13/cobra"
)

func TerminateExistingContainer(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "docker", "ps", "-q", "-f", "label=gp-rebuild")
	containerIds, err := cmd.Output()
	if err != nil {
		return err
	}

	for _, id := range strings.Split(string(containerIds), "\n") {
		if len(id) == 0 {
			continue
		}

		cmd = exec.CommandContext(ctx, "docker", "stop", id)
		err := cmd.Run()
		if err != nil {
			return err
		}

		cmd = exec.CommandContext(ctx, "docker", "rm", "-f", id)
		err = cmd.Run()
		if err != nil {
			return err
		}
	}

	return nil
}

func runRebuild(ctx context.Context, wsInfo *api.WorkspaceInfoResponse) error {
	tmpDir, err := os.MkdirTemp("", "gp-rebuild-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	gitpodConfig, err := utils.ParseGitpodConfig(wsInfo.CheckoutLocation)
	if err != nil {
		fmt.Println("The .gitpod.yml file cannot be parsed: please check the file and try again")
		fmt.Println("")
		fmt.Println("For help check out the reference page:")
		fmt.Println("https://www.gitpod.io/docs/references/gitpod-yml#gitpodyml")
		return GpError{Err: err, OutCome: utils.Outcome_UserErr, ErrorCode: utils.RebuildErrorCode_MalformedGitpodYaml, Silence: true}
	}

	if gitpodConfig == nil {
		fmt.Println("To test the image build, you need to configure your project with a .gitpod.yml file")
		fmt.Println("")
		fmt.Println("For a quick start, try running:\n$ gp init -i")
		fmt.Println("")
		fmt.Println("Alternatively, check out the following docs for getting started configuring your project")
		fmt.Println("https://www.gitpod.io/docs/configure#configure-gitpod")
		return GpError{OutCome: utils.Outcome_UserErr, ErrorCode: utils.RebuildErrorCode_MissingGitpodYaml, Silence: true}
	}

	var baseimage string
	switch img := gitpodConfig.Image.(type) {
	case nil:
		baseimage = ""
	case string:
		baseimage = "FROM " + img
	case map[interface{}]interface{}:
		dockerfilePath := filepath.Join(wsInfo.CheckoutLocation, img["file"].(string))

		if _, err := os.Stat(dockerfilePath); os.IsNotExist(err) {
			fmt.Println("Your .gitpod.yml points to a Dockerfile that doesn't exist: " + dockerfilePath)
			return GpError{Err: err, OutCome: utils.Outcome_UserErr, Silence: true}
		}
		dockerfile, err := os.ReadFile(dockerfilePath)
		if err != nil {
			return err
		}
		if string(dockerfile) == "" {
			fmt.Println("Your Gitpod's Dockerfile is empty")
			fmt.Println("")
			fmt.Println("To learn how to customize your workspace, check out the following docs:")
			fmt.Println("https://www.gitpod.io/docs/configure/workspaces/workspace-image#use-a-custom-dockerfile")
			fmt.Println("")
			fmt.Println("Once you configure your Dockerfile, re-run this command to validate your changes")
			return GpError{OutCome: utils.Outcome_UserErr, Silence: true}
		}
		baseimage = "\n" + string(dockerfile) + "\n"
	default:
		fmt.Println("Check your .gitpod.yml and make sure the image property is configured correctly")
		return GpError{OutCome: utils.Outcome_UserErr, ErrorCode: utils.RebuildErrorCode_MalformedGitpodYaml, Silence: true}
	}

	if baseimage == "" {
		fmt.Println("Your project is not using any custom Docker image.")
		fmt.Println("Check out the following docs, to know how to get started")
		fmt.Println("")
		fmt.Println("https://www.gitpod.io/docs/configure/workspaces/workspace-image#use-a-public-docker-image")
		return GpError{OutCome: utils.Outcome_UserErr, ErrorCode: utils.RebuildErrorCode_NoCustomImage, Silence: true}
	}

	tmpDockerfile := filepath.Join(tmpDir, "Dockerfile")

	err = os.WriteFile(tmpDockerfile, []byte(baseimage), 0644)
	if err != nil {
		fmt.Println("Could not write the temporary Dockerfile")
		return err
	}

	dockerPath, err := exec.LookPath("docker")
	if err != nil {
		fmt.Println("Docker is not installed in your workspace")
		return err
	}

	tag := "gp-rebuild-temp-build"

	dockerCmd := exec.CommandContext(ctx, dockerPath, "build", "-f", tmpDockerfile, "-t", tag, wsInfo.CheckoutLocation)
	dockerCmd.Stdout = os.Stdout
	dockerCmd.Stderr = os.Stderr

	imageBuildStartTime := time.Now()
	err = dockerCmd.Run()
	utils.TrackCommandUsageEvent.ImageBuildDuration = time.Since(imageBuildStartTime).Milliseconds()
	if _, ok := err.(*exec.ExitError); ok {
		fmt.Println("Image Build Failed")
		return GpError{OutCome: utils.Outcome_UserErr, ErrorCode: utils.RebuildErrorCode_ImageBuildFailed, Silence: true}
	} else if err != nil {
		fmt.Println("Docker error")
		return GpError{Err: err, ErrorCode: utils.RebuildErrorCode_DockerErr, Silence: true}
	}

	err = TerminateExistingContainer(ctx)
	if err != nil {
		return err
	}

	welcomeMessage := strings.Join([]string{
		"\n\nYou are now connected to the container.",
		"Check if all tools and libraries you need are properly installed.",
		"When you are done, type \"exit\" to return to your Gitpod workspace.\n",
	}, "\n")

	dockerRunCmd := exec.CommandContext(ctx,
		dockerPath,
		"run",
		"--rm",
		"-v", "/workspace:/workspace",
		"--label", "gp-rebuild=true",
		"-it", tag,
		"sh",
		"-c",
		fmt.Sprintf(`
			echo "%s";
			cd "%s";
			if [ -x "$(command -v $SHELL)" ]; then
				$SHELL;
			else
				if [ -x "$(command -v bash)" ]; then
					bash;
				else
					sh;
				fi;
			fi;
		`, welcomeMessage, wsInfo.CheckoutLocation),
	)

	dockerRunCmd.Stdout = os.Stdout
	dockerRunCmd.Stderr = os.Stderr
	dockerRunCmd.Stdin = os.Stdin

	err = dockerRunCmd.Start()
	if err != nil {
		fmt.Println("Failed to run docker container")
		return GpError{Err: err, OutCome: utils.Outcome_UserErr, ErrorCode: utils.RebuildErrorCode_DockerRunFailed, Silence: true}
	}

	_ = dockerRunCmd.Wait()

	return nil
}

var buildCmd = &cobra.Command{
	Use:    "rebuild",
	Short:  "Re-builds the workspace image (useful to debug a workspace custom image)",
	Hidden: false,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithCancel(context.Background())
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
		go func() {
			<-sigChan
			cancel()
		}()
		wsInfo, err := gitpod.GetWSInfo(ctx)
		if err != nil {
			return err
		}

		return runRebuild(ctx, wsInfo)
	},
}

func init() {
	rootCmd.AddCommand(buildCmd)
}
