import { useEffect, useMemo, useState } from "react";
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

const PROVIDERS: Array<{ id: ProviderName; label: string }> = [
  { id: "github", label: "GitHub" },
  { id: "jira", label: "Jira" },
  { id: "google", label: "Google" },
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
          <div>
            <span className="auth-modal-eyebrow">Continue in Team Assist</span>
            <h2 id="auth-modal-title">{headerTitle}</h2>
            <p>{helperText}</p>
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
