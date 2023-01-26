/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import { AuthProviderEntry } from "@gitpod/gitpod-protocol";
import { FunctionComponent, useCallback, useEffect, useMemo, useState } from "react";
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
import { useUpsertAuthProviderMutation } from "../../data/auth-providers/upsert-auth-provider-mutation";
import { useInvalidateOwnAuthProvidersQuery } from "../../data/auth-providers/own-auth-providers-query";

type Props = {
    provider?: AuthProviderEntry;
    login?: boolean;
    headerText?: string;
    userId: string;
    onClose: () => void;
};

export const GitIntegrationModal: FunctionComponent<Props> = (props) => {
    const [type, setType] = useState<string>(props.provider?.type ?? "GitLab");
    const [host, setHost] = useState<string>(props.provider?.host ?? "");
    const [clientId, setClientId] = useState<string>(props.provider?.oauth.clientId ?? "");
    const [clientSecret, setClientSecret] = useState<string>(props.provider?.oauth.clientSecret ?? "");

    const [redirectURL, setRedirectURL] = useState<string>(
        props.provider?.oauth.callBackUrl ?? callbackUrl("gitlab.example.com"),
    );

    const [savedProvider, setSavedProvider] = useState(props.provider);
    const isNew = !savedProvider;

    const [busy, setBusy] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | undefined>();

    const upsertProvider = useUpsertAuthProviderMutation();
    const invalidateOwnAuthProviders = useInvalidateOwnAuthProvidersQuery();

    const {
        message: clientIdError,
        onBlur: clientIdOnBlur,
        isValid: clientIdValid,
    } = useOnBlurError(`${type === "GitLab" ? "Application ID" : "Client ID"} is missing.`, clientId.trim().length > 0);

    const {
        message: clientSecretError,
        onBlur: clientSecretOnBlur,
        isValid: clientSecretValid,
    } = useOnBlurError(`${type === "GitLab" ? "Secret" : "Client Secret"} is missing.`, clientSecret.trim().length > 0);

    // Should do this kind of trimming on blur to avoid mutating value as user types
    // ditto to the client id/secret updates
    const updateHostValue = useCallback(
        (host: string) => {
            if (isNew) {
                let newHostValue = host;

                if (host.startsWith("https://")) {
                    newHostValue = host.replace("https://", "");
                }

                setHost(newHostValue);
                setRedirectURL(callbackUrl(newHostValue));
                setErrorMessage(undefined);
            }
        },
        [isNew],
    );

    // "bitbucket.org" is set as host value whenever "Bitbucket" is selected
    useEffect(() => {
        if (isNew) {
            updateHostValue(type === "Bitbucket" ? "bitbucket.org" : "");
        }
    }, [isNew, type, updateHostValue]);

    // Used to grab latest provider record after a successful activation flow
    const reloadSavedProvider = useCallback(async () => {
        if (!savedProvider) {
            return;
        }

        const provider = (await getGitpodService().server.getOwnAuthProviders()).find(
            (ap) => ap.id === savedProvider.id,
        );
        if (provider) {
            setSavedProvider(provider);
        }
    }, [savedProvider]);

    // modal submission
    // make api call
    // handle loading/error states
    //
    const activate = useCallback(async () => {
        const trimmedId = clientId.trim();
        const trimmedSecret = clientSecret.trim();

        let entry = isNew
            ? ({
                  host,
                  type,
                  clientId: trimmedId,
                  clientSecret: trimmedSecret,
                  ownerId: props.userId,
              } as AuthProviderEntry.NewEntry)
            : ({
                  id: props.provider?.id,
                  ownerId: props.userId,
                  clientId: trimmedId,
                  clientSecret: clientSecret === "redacted" ? undefined : trimmedSecret,
              } as AuthProviderEntry.UpdateEntry);

        setBusy(true);
        setErrorMessage(undefined);
        try {
            const newProvider = await upsertProvider.mutateAsync({ provider: entry });

            // switch mode to stay and edit this integration.
            setSavedProvider(newProvider);

            // the server is checking periodically for updates of dynamic providers, thus we need to
            // wait at least 2 seconds for the changes to be propagated before we try to use this provider.
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // onUpdate();

            // just open the authorization window and do *not* await
            openAuthorizeWindow({
                login: props.login,
                host: newProvider.host,
                onSuccess: (payload) => {
                    invalidateOwnAuthProviders();

                    props.onClose();
                },
                onError: (payload) => {
                    reloadSavedProvider();

                    let errorMessage: string;
                    if (typeof payload === "string") {
                        errorMessage = payload;
                    } else {
                        errorMessage = payload.description ? payload.description : `Error: ${payload.error}`;
                    }
                    setErrorMessage(errorMessage);
                },
            });
        } catch (error) {
            console.log(error);
            setErrorMessage("message" in error ? error.message : "Failed to update Git provider");
        }
        setBusy(false);
    }, [
        clientId,
        clientSecret,
        host,
        invalidateOwnAuthProviders,
        isNew,
        props,
        reloadSavedProvider,
        type,
        upsertProvider,
    ]);

    const isValid = useMemo(() => clientIdValid && clientSecretValid, [clientIdValid, clientSecretValid]);

    return (
        <Modal visible onClose={props.onClose}>
            <ModalHeader>{isNew ? "New Git Integration" : "Git Integration"}</ModalHeader>
            <ModalBody>
                {!isNew && savedProvider?.status !== "verified" && (
                    <Alert type="warning">You need to activate this integration.</Alert>
                )}
                <div className="flex flex-col">
                    <span className="text-gray-500">
                        {props.headerText ||
                            "Configure an integration with a self-managed instance of GitLab, GitHub, or Bitbucket."}
                    </span>
                </div>

                <div className="overscroll-contain max-h-96 overflow-y-auto pr-2">
                    {isNew && (
                        <SelectInputField label="Provider Type" value={type} onChange={setType}>
                            <option value="GitHub">GitHub</option>
                            <option value="GitLab">GitLab</option>
                            {!isGitpodIo() && <option value="Bitbucket">Bitbucket</option>}
                            <option value="BitbucketServer">Bitbucket Server</option>
                        </SelectInputField>
                    )}
                    {isNew && type === "BitbucketServer" && (
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
                        disabled={!isNew || type === "Bitbucket"}
                        placeholder={getPlaceholderForIntegrationType(type)}
                        onChange={updateHostValue}
                    />

                    <InputField label="Redirect URL" hint={<RedirectUrlDescription type={type} host={host} />}>
                        <InputWithCopy value={redirectURL} tip="Copy the Redirect URL to clipboard" />
                    </InputField>

                    <TextInputField
                        label={type === "GitLab" ? "Application ID" : "Client ID"}
                        value={clientId}
                        error={clientIdError}
                        onBlur={clientIdOnBlur}
                        onChange={setClientId}
                    />

                    <TextInputField
                        label={type === "GitLab" ? "Secret" : "Client Secret"}
                        type="password"
                        value={clientSecret}
                        error={clientSecretError}
                        onChange={setClientSecret}
                        onBlur={clientSecretOnBlur}
                    />
                </div>

                {errorMessage && (
                    <div className="flex rounded-md bg-red-600 p-3">
                        <img
                            className="w-4 h-4 mx-2 my-auto filter-brightness-10"
                            src={exclamation}
                            alt="exclamation mark"
                        />
                        <span className="text-white">{errorMessage}</span>
                    </div>
                )}
            </ModalBody>
            <ModalFooter>
                <button onClick={activate} disabled={!isValid || busy}>
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

const useOnBlurError = (message: string, isValid: boolean) => {
    const [hasBlurred, setHasBlurred] = useState(false);

    const onBlur = useCallback(() => {
        setHasBlurred(true);
    }, []);

    return { message: !isValid && hasBlurred ? message : "", isValid, onBlur };
};
