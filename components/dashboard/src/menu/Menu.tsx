/**
 * Copyright (c) 2021 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import { User, Project } from "@gitpod/gitpod-protocol";
import { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLocation } from "react-router";
import { Location } from "history";
import { countries } from "countries-list";
import gitpodIcon from "../icons/gitpod.svg";
import { getGitpodService, gitpodHostUrl } from "../service/service";
import { useCurrentUser } from "../user-context";
import { useBillingModeForCurrentTeam, useCurrentTeam, useTeamMemberInfos } from "../teams/teams-context";
import ContextMenu from "../components/ContextMenu";
import Separator from "../components/Separator";
import PillMenuItem from "../components/PillMenuItem";
import TabMenuItem from "../components/TabMenuItem";
import { getTeamSettingsMenu } from "../teams/TeamSettings";
import { getProjectSettingsMenu } from "../projects/ProjectSettings";
import { useCurrentProject, useProjectSlug as useProjectSlugs } from "../projects/project-context";
import { PaymentContext } from "../payment-context";
import FeedbackFormModal from "../feedback-form/FeedbackModal";
import { inResource } from "../utils";
import { BillingMode } from "@gitpod/gitpod-protocol/lib/billing-mode";
import { FeatureFlagContext } from "../contexts/FeatureFlagContext";
import OrganizationSelector from "./OrganizationSelector";

interface Entry {
    title: string;
    link: string;
    alternatives?: string[];
}

export default function Menu() {
    const user = useCurrentUser();
    const team = useCurrentTeam();
    const location = useLocation();
    const teamBillingMode = useBillingModeForCurrentTeam();
    const { showUsageView, oidcServiceEnabled } = useContext(FeatureFlagContext);
    const { setCurrency, setIsStudent, setIsChargebeeCustomer } = useContext(PaymentContext);
    const [userBillingMode, setUserBillingMode] = useState<BillingMode | undefined>(undefined);
    const [isFeedbackFormVisible, setFeedbackFormVisible] = useState<boolean>(false);

    const { projectSlug, prebuildId } = useProjectSlugs();
    const project = useCurrentProject();
    const teamMembers = useTeamMemberInfos();

    useEffect(() => {
        getGitpodService().server.getBillingModeForUser().then(setUserBillingMode);
    }, []);

    function isSelected(entry: Entry, location: Location<any>) {
        const all = [entry.link, ...(entry.alternatives || [])].map((l) => l.toLowerCase());
        const path = location.pathname.toLowerCase();
        return all.some((n) => n === path || n + "/" === path);
    }

    // Hide most of the top menu when in a full-page form.
    const isMinimalUI = inResource(location.pathname, ["new", "orgs/new", "open"]);
    const isWorkspacesUI = inResource(location.pathname, ["workspaces"]);
    const isPersonalSettingsUI = inResource(location.pathname, [
        "account",
        "notifications",
        "billing",
        "plans",
        "teams",
        "orgs",
        "variables",
        "keys",
        "integrations",
        "preferences",
        "tokens",
    ]);
    const isAdminUI = inResource(window.location.pathname, ["admin"]);

    useEffect(() => {
        const { server } = getGitpodService();
        Promise.all([
            server.getClientRegion().then((v) => () => {
                // @ts-ignore
                setCurrency(countries[v]?.currency === "EUR" ? "EUR" : "USD");
            }),
            server.isStudent().then((v) => () => setIsStudent(v)),
            server.isChargebeeCustomer().then((v) => () => setIsChargebeeCustomer(v)),
        ]).then((setters) => setters.forEach((s) => s()));
    }, [setCurrency, setIsChargebeeCustomer, setIsStudent]);

    const projectMenu: Entry[] = useMemo(() => {
        // Project menu
        if (!projectSlug) {
            return [];
        }
        return [
            {
                title: "Branches",
                link: `/projects/${projectSlug}`,
            },
            {
                title: "Prebuilds",
                link: `/projects/${projectSlug}/prebuilds`,
            },
            {
                title: "Settings",
                link: `/projects/${projectSlug}/settings`,
                alternatives: getProjectSettingsMenu({ slug: projectSlug } as Project, team).flatMap((e) => e.link),
            },
        ];
    }, [projectSlug, team]);

    const leftMenu = useMemo(() => {
        const leftMenu: Entry[] = [
            {
                title: "Workspaces",
                link: "/workspaces",
                alternatives: ["/"],
            },
            {
                title: "Projects",
                link: `/projects`,
                alternatives: [] as string[],
            },
        ];

        if (
            !team &&
            BillingMode.showUsageBasedBilling(userBillingMode) &&
            !user?.additionalData?.isMigratedToTeamOnlyAttribution
        ) {
            leftMenu.push({
                title: "Usage",
                link: "/usage",
            });
        }
        if (team) {
            leftMenu.push({
                title: "Members",
                link: `/members`,
            });
            const currentUserInTeam = (teamMembers[team.id] || []).find((m) => m.userId === user?.id);
            if (
                currentUserInTeam?.role === "owner" &&
                (showUsageView || (teamBillingMode && teamBillingMode.mode === "usage-based"))
            ) {
                leftMenu.push({
                    title: "Usage",
                    link: `/usage`,
                });
            }
            if (currentUserInTeam?.role === "owner") {
                leftMenu.push({
                    title: "Settings",
                    link: `/org-settings`,
                    alternatives: getTeamSettingsMenu({
                        team,
                        billingMode: teamBillingMode,
                        ssoEnabled: oidcServiceEnabled,
                    }).flatMap((e) => e.link),
                });
            }
        }
        return leftMenu;
    }, [oidcServiceEnabled, showUsageView, team, teamBillingMode, teamMembers, user, userBillingMode]);

    const handleFeedbackFormClick = () => {
        setFeedbackFormVisible(true);
    };

    const onFeedbackFormClose = () => {
        setFeedbackFormVisible(false);
    };

    return (
        <>
            <header className="app-container flex flex-col pt-4 space-y-4" data-analytics='{"button_type":"menu"}'>
                <div className="flex h-10 mb-3">
                    <div className="flex justify-between items-center pr-3">
                        <Link to="/">
                            <img src={gitpodIcon} className="h-6" alt="Gitpod's logo" />
                        </Link>
                        {!isMinimalUI && (
                            <>
                                <div className="pl-2 text-base text-gray-500 dark:text-gray-400 flex">
                                    {leftMenu.map((entry) => (
                                        <div className="p-1" key={entry.title}>
                                            <PillMenuItem
                                                name={entry.title}
                                                selected={isSelected(entry, location)}
                                                link={entry.link}
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="flex p-1">
                                    {projectSlug && !prebuildId && !isAdminUI && (
                                        <Link to={`/projects/${projectSlug}${prebuildId ? "/prebuilds" : ""}`}>
                                            <span className=" flex h-full text-base text-gray-50 bg-gray-800 dark:bg-gray-50 dark:text-gray-900 font-semibold ml-2 px-3 py-1 rounded-2xl border-gray-100">
                                                {project?.name}
                                            </span>
                                        </Link>
                                    )}
                                    {prebuildId && (
                                        <Link to={`/projects/${projectSlug}${prebuildId ? "/prebuilds" : ""}`}>
                                            <span className=" flex h-full text-base text-gray-500 bg-gray-50 hover:bg-gray-100 dark:text-gray-400 dark:bg-gray-800 dark:hover:bg-gray-700 font-semibold ml-2 px-3 py-1 rounded-2xl border-gray-100">
                                                {project?.name}
                                            </span>
                                        </Link>
                                    )}
                                    {prebuildId && (
                                        <div className="flex ml-2">
                                            <div className="flex pl-0 pr-1 py-1.5">
                                                <svg
                                                    width="20"
                                                    height="20"
                                                    fill="none"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                >
                                                    <path
                                                        fillRule="evenodd"
                                                        clipRule="evenodd"
                                                        d="M7.293 14.707a1 1 0 0 1 0-1.414L10.586 10 7.293 6.707a1 1 0 1 1 1.414-1.414l4 4a1 1 0 0 1 0 1.414l-4 4a1 1 0 0 1-1.414 0Z"
                                                        fill="#78716C"
                                                    />
                                                </svg>
                                            </div>
                                            <Link to={`/projects/${projectSlug}/${prebuildId}`}>
                                                <span className="flex h-full text-base text-gray-50 bg-gray-800 dark:bg-gray-50 dark:text-gray-900 font-semibold px-3 py-1 rounded-2xl border-gray-100">
                                                    {prebuildId.substring(0, 8).trimEnd()}
                                                </span>
                                            </Link>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="flex-grow"></div>
                    <div className="flex items-center w-auto" id="menu">
                        <OrganizationSelector />
                        <div
                            className="ml-3 flex items-center justify-start mb-0 pointer-cursor m-l-auto rounded-full border-2 border-transparent hover:border-gray-200 dark:hover:border-gray-700 p-0.5 font-medium flex-shrink-0"
                            data-analytics='{"label":"Account"}'
                        >
                            <ContextMenu
                                menuEntries={[
                                    {
                                        title: (user && (User.getPrimaryEmail(user) || user?.name)) || "User",
                                        customFontStyle: "text-gray-400",
                                        separator: true,
                                    },
                                    {
                                        title: "Settings",
                                        link: "/settings",
                                    },
                                    {
                                        title: "Settings",
                                        link: "/settings",
                                    },
                                    {
                                        title: "Admin",
                                        link: "/admin",
                                    },
                                    {
                                        title: "Docs",
                                        href: "https://www.gitpod.io/docs/",
                                        target: "_blank",
                                        rel: "noreferrer",
                                    },
                                    {
                                        title: "Help",
                                        href: "https://www.gitpod.io/support/",
                                        target: "_blank",
                                        rel: "noreferrer",
                                        separator: true,
                                    },
                                    {
                                        title: "Feedback",
                                        onClick: handleFeedbackFormClick,
                                    },
                                    {
                                        title: "Logout",
                                        href: gitpodHostUrl.asApiLogout().toString(),
                                    },
                                ]}
                            >
                                <img
                                    className="rounded-full w-6 h-6"
                                    src={user?.avatarUrl || ""}
                                    alt={user?.name || "Anonymous"}
                                />
                            </ContextMenu>
                        </div>
                    </div>
                    {isFeedbackFormVisible && <FeedbackFormModal onClose={onFeedbackFormClose} />}
                </div>
                {!isMinimalUI && !prebuildId && !isWorkspacesUI && !isPersonalSettingsUI && !isAdminUI && (
                    <nav className="flex">
                        {projectMenu.map((entry: Entry) => (
                            <TabMenuItem
                                key={entry.title}
                                name={entry.title}
                                selected={isSelected(entry, location)}
                                link={entry.link}
                            />
                        ))}
                    </nav>
                )}
            </header>
            <Separator />
        </>
    );
}
