import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionResponse } from "@/hooks/useSession";

interface InvitationPayload {
  invitation: {
    email: string;
    role: string;
  };
}

interface Props {
  open: boolean;
  mode: "login" | "register";
  session: SessionResponse | undefined;
  inviteToken: string | null;
  providerMessage: string | null;
  onClose: () => void;
  onModeChange: (mode: "login" | "register") => void;
  onAuthenticated: () => Promise<void>;
}

type ProviderName = "github" | "jira" | "google";

const PROVIDERS: Array<{ id: ProviderName; label: string; icon: ReactNode }> = [
  {
    id: "github",
    label: "GitHub",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.82-.26.82-.58l-.02-2.05c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.31-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6.02 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.21.7.82.58A12 12 0 0 0 12 .3" />
      </svg>
    ),
  },
  {
    id: "jira",
    label: "Jira",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M11.53 2c0 5.24-4.26 9.5-9.53 9.5v1c5.27 0 9.53 4.26 9.53 9.5h.94c0-5.24 4.26-9.5 9.53-9.5v-1c-5.27 0-9.53-4.26-9.53-9.5h-.94z" fill="#2684FF" />
      </svg>
    ),
  },
  {
    id: "google",
    label: "Google",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    ),
  },
];

export function AuthModal({
  open,
  mode,
  session,
  inviteToken,
  providerMessage,
  onClose,
  onModeChange,
  onAuthenticated,
}: Props) {
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [invitationMessage, setInvitationMessage] = useState<string | null>(null);
  const [loadingInvitation, setLoadingInvitation] = useState(false);

  const providerModes = session?.providerAuth.providerModes ?? {
    github: "unavailable",
    jira: "unavailable",
    google: "unavailable",
  };

  const headerTitle = useMemo(() => {
    if (mode === "register") {
      return "Create your workspace account";
    }

    return "Sign in to keep working";
  }, [mode]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setStatus(providerMessage ?? null);
  }, [open, providerMessage]);

  useEffect(() => {
    if (!open || mode !== "register" || !inviteToken) {
      setInvitationMessage(null);
      setLoadingInvitation(false);
      return;
    }

    let cancelled = false;
    setLoadingInvitation(true);

    void fetch(`/api/v1/auth/invitations/${inviteToken}`, {
      credentials: "same-origin",
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Partial<InvitationPayload> & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Invitation could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        const invitation = payload.invitation;
        if (!invitation) {
          setInvitationMessage("Invitation could not be loaded.");
          return;
        }

        setEmail(invitation.email);
        setInvitationMessage(
          `Invited as ${invitation.role} for ${invitation.email}. Register with that email to join the workspace.`
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setInvitationMessage(error instanceof Error ? error.message : "Invitation could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingInvitation(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [inviteToken, mode, open]);

  if (!open) {
    return null;
  }

  const submitLabel = mode === "register" ? "Create account" : "Sign in";
  const helperText =
    mode === "register"
      ? "Save your prompts, connect providers, and keep the workspace persistent."
      : "Pick up where guest mode left off and continue in the same workspace.";

  const handleProviderStart = (provider: ProviderName) => {
    if (providerModes[provider] === "unavailable") {
      setStatus(`${PROVIDERS.find((entry) => entry.id === provider)?.label ?? provider} sign-in is unavailable in this environment.`);
      return;
    }

    window.location.href = `/api/v1/auth/providers/${provider}/start`;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSubmitting(true);
    setStatus(mode === "register" ? "Creating account..." : "Signing in...");

    try {
      const payload =
        mode === "register"
          ? {
              name,
              email,
              password,
              organizationName: inviteToken ? undefined : organizationName,
              inviteToken: inviteToken ?? undefined,
            }
          : {
              email,
              password,
            };

      const response = await fetch(`/api/v1/auth/${mode}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": session?.csrfToken ?? "",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Authentication failed.");
      }

      setStatus("Success. Opening your workspace...");
      await onAuthenticated();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <div className="auth-modal-header">
          <div className="auth-modal-header-main">
            <div className="auth-modal-brand" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <span className="auth-modal-eyebrow">Continue in Team Assist</span>
              <h2 id="auth-modal-title">{headerTitle}</h2>
              <p>{helperText}</p>
            </div>
          </div>
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close sign-in dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="auth-modal-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            className={`auth-modal-tab${mode === "login" ? " is-active" : ""}`}
            onClick={() => onModeChange("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`auth-modal-tab${mode === "register" ? " is-active" : ""}`}
            onClick={() => onModeChange("register")}
          >
            Create account
          </button>
        </div>

        <div className="auth-modal-provider-grid">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="auth-provider-button"
              disabled={providerModes[provider.id] === "unavailable"}
              onClick={() => handleProviderStart(provider.id)}
            >
              <span className="auth-provider-icon">{provider.icon}</span>
              {mode === "register" ? `Continue with ${provider.label}` : `Sign in with ${provider.label}`}
            </button>
          ))}
        </div>

        <div className="auth-modal-divider">
          <span>or use email</span>
        </div>

        {mode === "register" && (loadingInvitation || invitationMessage) && (
          <div className={`auth-modal-note${loadingInvitation ? " is-loading" : ""}`}>
            {loadingInvitation ? "Loading invitation..." : invitationMessage}
          </div>
        )}

        <form className="auth-modal-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <label className="auth-modal-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                autoComplete="name"
                required
              />
            </label>
          )}

          <label className="auth-modal-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="auth-modal-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
            />
          </label>

          {mode === "register" && !inviteToken && (
            <label className="auth-modal-field">
              <span>Workspace name</span>
              <input
                type="text"
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Acme Operations"
                autoComplete="organization"
                required
              />
            </label>
          )}

          <button type="submit" className="btn-primary auth-modal-submit" disabled={submitting}>
            {submitLabel}
          </button>
        </form>

        <div className="auth-modal-footer">
          <span>
            {mode === "register" ? "Already have an account?" : "Need a workspace account?"}
          </span>
          <button
            type="button"
            className="auth-modal-inline-link"
            onClick={() => onModeChange(mode === "register" ? "login" : "register")}
          >
            {mode === "register" ? "Sign in" : "Create one"}
          </button>
        </div>

        {status && <p className="auth-modal-status">{status}</p>}
      </div>
    </div>
  );
}
