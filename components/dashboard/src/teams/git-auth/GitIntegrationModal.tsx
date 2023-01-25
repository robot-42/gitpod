/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import { AuthProviderEntry } from "@gitpod/gitpod-protocol";
import { FunctionComponent, useEffect, useState } from "react";
import Alert from "../../components/Alert";
import InfoBox from "../../components/InfoBox";
import { InputWithCopy } from "../../components/InputWithCopy";
import Modal, { ModalBody, ModalFooter, ModalHeader } from "../../components/Modal";
import { openAuthorizeWindow } from "../../provider-utils";
import { getGitpodService, gitpodHostUrl } from "../../service/service";
import { isGitpodIo } from "../../utils";
import exclamation from "../../images/exclamation.svg";
import { TextInputField } from "../../components/forms/TextInputField";
import { InputField } from "../../components/forms/InputField";
import { SelectInputField } from "../../components/forms/SelectInputField";

type Props = {
    mode: "new" | "edit";
    provider?: AuthProviderEntry;
    login?: boolean;
    headerText?: string;
    userId: string;
    onClose?: () => void;
    onUpdate?: () => void;
    onAuthorize?: (payload?: string) => void;
};

export const GitIntegrationModal: FunctionComponent<Props> = (props) => {
    // TODO: maybe swap this to a boolean, isNew or something else?
    const [mode, setMode] = useState<"new" | "edit">(props.mode || "new");

    // This makes this a stateful component that manages this state now - perhaps we don't need to?
    const [providerEntry, setProviderEntry] = useState<AuthProviderEntry | undefined>(props.provider);

    const [type, setType] = useState<string>(props.provider?.type ?? "GitLab");
    const [host, setHost] = useState<string>(props.provider?.host ?? "");
    const [clientId, setClientId] = useState<string>(props.provider?.oauth.clientId ?? "");
    const [clientSecret, setClientSecret] = useState<string>(props.provider?.oauth.clientSecret ?? "");

    const [redirectURL, setRedirectURL] = useState<string>(
        props.provider?.oauth.callBackUrl ?? callbackUrl("gitlab.example.com"),
    );

    const [busy, setBusy] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | undefined>();
    const [validationError, setValidationError] = useState<string | undefined>();

    // this defaults values on "mount" - look to just set initial state values
    // useEffect(() => {
    //     setMode(props.mode);
    //     if (props.mode === "edit") {
    //         setProviderEntry(props.provider);
    //         setType(props.provider.type);
    //         setHost(props.provider.host);
    //         setClientId(props.provider.oauth.clientId);
    //         setClientSecret(props.provider.oauth.clientSecret);
    //         setRedirectURL(props.provider.oauth.callBackUrl);
    //     }
    // }, []);

    // Have derived, memoized values for the error validation instead?
    useEffect(() => {
        setErrorMessage(undefined);
        validate();
    }, [clientId, clientSecret, type]);

    // "bitbucket.org" is set as host value whenever "Bitbucket" is selected
    useEffect(() => {
        if (props.mode === "new") {
            updateHostValue(type === "Bitbucket" ? "bitbucket.org" : "");
        }
    }, [type]);

    const onClose = () => props.onClose && props.onClose();
    const onUpdate = () => props.onUpdate && props.onUpdate();

    // modal submission
    // make api call
    // handle loading/error states
    //
    const activate = async () => {
        let entry =
            mode === "new"
                ? ({
                      host,
                      type,
                      clientId,
                      clientSecret,
                      ownerId: props.userId,
                  } as AuthProviderEntry.NewEntry)
                : ({
                      id: providerEntry?.id,
                      ownerId: props.userId,
                      clientId,
                      clientSecret: clientSecret === "redacted" ? undefined : clientSecret,
                  } as AuthProviderEntry.UpdateEntry);

        setBusy(true);
        setErrorMessage(undefined);
        try {
            // mutation goes here :smile:
            const newProvider = await getGitpodService().server.updateOwnAuthProvider({ entry });

            // the server is checking periodically for updates of dynamic providers, thus we need to
            // wait at least 2 seconds for the changes to be propagated before we try to use this provider.
            await new Promise((resolve) => setTimeout(resolve, 2000));

            onUpdate();

            // accounts for a "new" turning into a "edit" mode maybe?
            const updateProviderEntry = async () => {
                const provider = (await getGitpodService().server.getOwnAuthProviders()).find(
                    (ap) => ap.id === newProvider.id,
                );
                if (provider) {
                    setProviderEntry(provider);
                }
            };

            // just open the authorization window and do *not* await
            openAuthorizeWindow({
                login: props.login,
                host: newProvider.host,
                onSuccess: (payload) => {
                    updateProviderEntry();
                    onUpdate();
                    props.onAuthorize && props.onAuthorize(payload);
                    onClose();
                },
                onError: (payload) => {
                    updateProviderEntry();
                    let errorMessage: string;
                    if (typeof payload === "string") {
                        errorMessage = payload;
                    } else {
                        errorMessage = payload.description ? payload.description : `Error: ${payload.error}`;
                    }
                    setErrorMessage(errorMessage);
                },
            });

            // switch mode to stay and edit this integration.
            // this modal is expected to be closed programmatically.
            setMode("edit");
            setProviderEntry(newProvider);
        } catch (error) {
            console.log(error);
            setErrorMessage("message" in error ? error.message : "Failed to update Git provider");
        }
        setBusy(false);
    };

    // Should do this kind of trimming on blur to avoid mutating value as user types
    // ditto to the client id/secret updates
    const updateHostValue = (host: string) => {
        if (mode === "new") {
            let newHostValue = host;

            if (host.startsWith("https://")) {
                newHostValue = host.replace("https://", "");
            }

            setHost(newHostValue);
            setRedirectURL(callbackUrl(newHostValue));
            setErrorMessage(undefined);
        }
    };

    const updateClientId = (value: string) => {
        setClientId(value.trim());
    };
    const updateClientSecret = (value: string) => {
        setClientSecret(value.trim());
    };

    // can we do this on blur of corresponding elements as well?
    // i.e. show errors for "touched" / "dirty" fields
    const validate = () => {
        const errors: string[] = [];
        if (clientId.trim().length === 0) {
            errors.push(`${type === "GitLab" ? "Application ID" : "Client ID"} is missing.`);
        }
        if (clientSecret.trim().length === 0) {
            errors.push(`${type === "GitLab" ? "Secret" : "Client Secret"} is missing.`);
        }
        if (errors.length === 0) {
            setValidationError(undefined);
            return true;
        } else {
            setValidationError(errors.join("\n"));
            return false;
        }
    };

    return (
        <Modal visible onClose={onClose}>
            <ModalHeader>{mode === "new" ? "New Git Integration" : "Git Integration"}</ModalHeader>
            <ModalBody>
                {mode === "edit" && providerEntry?.status !== "verified" && (
                    <Alert type="warning">You need to activate this integration.</Alert>
                )}
                <div className="flex flex-col">
                    <span className="text-gray-500">
                        {props.headerText ||
                            "Configure an integration with a self-managed instance of GitLab, GitHub, or Bitbucket."}
                    </span>
                </div>

                <div className="overscroll-contain max-h-96 overflow-y-auto pr-2">
                    {mode === "new" && (
                        <SelectInputField
                            label="Provider Type"
                            value={type}
                            disabled={mode !== "new"}
                            onChange={setType}
                        >
                            <option value="GitHub">GitHub</option>
                            <option value="GitLab">GitLab</option>
                            {!isGitpodIo() && <option value="Bitbucket">Bitbucket</option>}
                            <option value="BitbucketServer">Bitbucket Server</option>
                        </SelectInputField>
                    )}
                    {mode === "new" && type === "BitbucketServer" && (
                        <InfoBox className="my-4 mx-auto">
                            OAuth 2.0 support in Bitbucket Server was added in version 7.20.{" "}
                            <a
                                target="_blank"
                                href="https://confluence.atlassian.com/bitbucketserver/bitbucket-data-center-and-server-7-20-release-notes-1101934428.html"
                                rel="noopener noreferrer"
                                className="gp-link"
                            >
                                Learn more
                            </a>
                        </InfoBox>
                    )}
                    <TextInputField
                        label="Provider Host Name"
                        value={host}
                        disabled={mode === "edit" || type === "Bitbucket"}
                        placeholder={getPlaceholderForIntegrationType(type)}
                        onChange={updateHostValue}
                    />

                    <InputField label="Redirect URL" hint={<RedirectUrlDescription type={type} host={host} />}>
                        <InputWithCopy value={redirectURL} tip="Copy the Redirect URL to clipboard" />
                    </InputField>

                    <TextInputField
                        label={type === "GitLab" ? "Application ID" : "Client ID"}
                        value={clientId}
                        onChange={updateClientId}
                    />

                    <TextInputField
                        label={type === "GitLab" ? "Secret" : "Client Secret"}
                        type="password"
                        value={clientSecret}
                        onChange={updateClientSecret}
                    />
                </div>

                {(errorMessage || validationError) && (
                    <div className="flex rounded-md bg-red-600 p-3">
                        <img className="w-4 h-4 mx-2 my-auto filter-brightness-10" src={exclamation} />
                        <span className="text-white">{errorMessage || validationError}</span>
                    </div>
                )}
            </ModalBody>
            <ModalFooter>
                <button onClick={() => validate() && activate()} disabled={!!validationError || busy}>
                    Activate Integration
                </button>
            </ModalFooter>
        </Modal>
    );
};

const callbackUrl = (host: string) => {
    // Negative Lookahead (?!\/)
    // `\/` matches the character `/`
    // "https://foobar:80".replace(/:(?!\/)/, "_")
    // => 'https://foobar_80'
    host = host.replace(/:(?!\/)/, "_");
    const pathname = `/auth/${host}/callback`;
    return gitpodHostUrl.with({ pathname }).toString();
};

const getPlaceholderForIntegrationType = (type: string) => {
    switch (type) {
        case "GitHub":
            return "github.example.com";
        case "GitLab":
            return "gitlab.example.com";
        case "BitbucketServer":
            return "bitbucket.example.com";
        case "Bitbucket":
            return "bitbucket.org";
        default:
            return "";
    }
};

type RedirectUrlDescriptionProps = {
    type: string;
    host: string;
};
const RedirectUrlDescription: FunctionComponent<RedirectUrlDescriptionProps> = ({ type, host }) => {
    let settingsUrl = ``;
    switch (type) {
        case "GitHub":
            settingsUrl = `${host}/settings/developers`;
            break;
        case "GitLab":
            settingsUrl = `${host}/-/profile/applications`;
            break;
        default:
            return null;
    }

    let docsUrl = ``;
    switch (type) {
        case "GitHub":
            docsUrl = `https://www.gitpod.io/docs/github-integration/#oauth-application`;
            break;
        case "GitLab":
            docsUrl = `https://www.gitpod.io/docs/gitlab-integration/#oauth-application`;
            break;
        default:
            return null;
    }

    return (
        <span>
            Use this redirect URL to update the OAuth application. Go to{" "}
            <a href={`https://${settingsUrl}`} target="_blank" rel="noreferrer noopener" className="gp-link">
                developer settings
            </a>{" "}
            and setup the OAuth application.&nbsp;
            <a href={docsUrl} target="_blank" rel="noreferrer noopener" className="gp-link">
                Learn more
            </a>
            .
        </span>
    );
};
