/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import { useContext, useEffect, useState } from "react";
import { Redirect } from "react-router";
import { TeamMemberInfo } from "@gitpod/gitpod-protocol";
import { BillingMode } from "@gitpod/gitpod-protocol/lib/billing-mode";
import { PageWithSubMenu } from "../components/PageWithSubMenu";
import { ReactComponent as Spinner } from "../icons/Spinner.svg";
import { useCurrentTeam } from "./teams-context";
import { getTeamSettingsMenu } from "./TeamSettings";
import { useCurrentUser } from "../user-context";
import { publicApiTeamMembersToProtocol, teamsService } from "../service/public-api";
import { FeatureFlagContext } from "../contexts/FeatureFlagContext";
import { getGitpodService } from "../service/service";
import { GitIntegrations } from "./git-auth/GitIntegrations";

export default function GitAuth() {
    const user = useCurrentUser();
    const team = useCurrentTeam();
    const [teamBillingMode, setTeamBillingMode] = useState<BillingMode | undefined>(undefined);
    const [isUserOwner, setIsUserOwner] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const { oidcServiceEnabled } = useContext(FeatureFlagContext);

    // TODO: can we abstract this to not have to manage this state on every settings page?
    useEffect(() => {
        if (!team) {
            return;
        }
        (async () => {
            const memberInfos = await teamsService.getTeam({ teamId: team!.id }).then((resp) => {
                return publicApiTeamMembersToProtocol(resp.team?.members || []);
            });
            getGitpodService().server.getBillingModeForTeam(team.id).then(setTeamBillingMode).catch(console.error);

            const currentUserInTeam = memberInfos.find((member: TeamMemberInfo) => member.userId === user?.id);
            const isUserOwner = currentUserInTeam?.role === "owner";
            setIsUserOwner(isUserOwner);
            setIsLoading(false);
        })();
    }, [team, user?.id]);

    if (!isUserOwner) {
        return <Redirect to={team ? `/t/${team.slug}` : "/"} />;
    }

    return (
        <PageWithSubMenu
            subMenu={getTeamSettingsMenu({ team, billingMode: teamBillingMode, ssoEnabled: oidcServiceEnabled })}
            title="Git Auth"
            subtitle="Setup Git Auth your organization."
        >
            {isLoading && (
                <div className="p-20">
                    <Spinner className="h-5 w-5 animate-spin" />
                </div>
            )}
            {!isLoading && team && isUserOwner && <GitIntegrations />}
        </PageWithSubMenu>
    );
}
