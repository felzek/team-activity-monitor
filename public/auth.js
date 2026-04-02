const form = document.getElementById("auth-form");
const status = document.getElementById("auth-status");
const mode = form?.dataset.mode || "login";
const organizationField = document.getElementById("organization-field");
const invitationPanel = document.getElementById("invitation-panel");
const invitationMessage = document.getElementById("invitation-message");
const inviteTokenInput = document.getElementById("invite-token");
const providerAuthPanel = document.getElementById("provider-auth-panel");
const providerAuthStatus = document.getElementById("provider-auth-status");
const providerButtons = Array.from(document.querySelectorAll(".provider-button"));

let csrfToken = null;
let providerAuthState = {
  mode: "unavailable",
  providerModes: {
    github: "unavailable",
    jira: "unavailable",
    google: "unavailable"
  }
};

function providerLabel(provider) {
  if (provider === "jira") return "Jira";
  if (provider === "google") return "Google";
  return "GitHub";
}

const PROVIDER_ICONS = {
  github:
    '<svg class="provider-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.82-.26.82-.58l-.02-2.05c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.31-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6.02 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.21.7.82.58A12 12 0 0 0 12 .3"/></svg>',
  jira:
    '<svg class="provider-icon" viewBox="0 0 24 24"><path d="M11.53 2c0 5.24-4.26 9.5-9.53 9.5v1c5.27 0 9.53 4.26 9.53 9.5h.94c0-5.24 4.26-9.5 9.53-9.5v-1c-5.27 0-9.53-4.26-9.53-9.5h-.94z" fill="#2684FF"/></svg>',
  google:
    '<svg class="provider-icon" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>'
};

function providerMode(provider) {
  return providerAuthState?.providerModes?.[provider] || "unavailable";
}

function syncProviderAuthUi(providerAuth) {
  if (!providerAuthPanel) {
    return;
  }

  providerAuthState = providerAuth || providerAuthState;

  providerButtons.forEach((button) => {
    const provider = button.dataset.provider || "github";
    const modeValue = providerMode(provider);
    button.disabled = modeValue === "unavailable";
    const icon = PROVIDER_ICONS[provider] || "";
    const verb = mode === "register" ? "Sign up" : "Log in";
    button.innerHTML =
      modeValue === "unavailable"
        ? `${icon} ${providerLabel(provider)} unavailable`
        : `${icon} ${verb} with ${providerLabel(provider)}`;
  });
}

function applyProviderAuthStatusFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("provider_auth");
  const provider = params.get("provider");
  const message = params.get("message");

  if (outcome !== "error" || !providerAuthStatus) {
    return;
  }

  providerAuthStatus.textContent =
    message ||
    `${provider ? providerLabel(provider) : "Provider"} sign-in could not be completed.`;
  window.history.replaceState({}, document.title, window.location.pathname);
}

async function loadSession() {
  const response = await fetch("/api/v1/auth/session");
  const payload = await response.json();
  csrfToken = payload.csrfToken;
  syncProviderAuthUi(payload.providerAuth);

  if (payload.authenticated) {
    window.location.href = "/app";
  }
}

async function loadInvitation() {
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("invite");

  if (!inviteToken || mode !== "register") {
    return;
  }

  inviteTokenInput.value = inviteToken;

  try {
    const response = await fetch(`/api/v1/auth/invitations/${inviteToken}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Invitation could not be loaded.");
    }

    invitationPanel.classList.remove("hidden");
    invitationMessage.textContent = `You were invited as ${payload.invitation.role} for ${payload.invitation.email}. Register with that email to join the workspace.`;
    organizationField.classList.add("hidden");
  } catch (error) {
    invitationPanel.classList.remove("hidden");
    invitationPanel.classList.add("warning-panel");
    invitationMessage.textContent =
      error instanceof Error ? error.message : "Invitation could not be loaded.";
  }
}

async function submitAuth(event) {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  status.textContent = mode === "register" ? "Creating account..." : "Signing in...";

  try {
    const response = await fetch(`/api/v1/auth/${mode}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken || ""
      },
      body: JSON.stringify(payload)
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.error || "Authentication failed.");
    }

    status.textContent = "Success. Redirecting...";
    window.location.href = "/app";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Unexpected error.";
  }
}

Promise.all([loadSession(), loadInvitation()])
  .then(() => {
    applyProviderAuthStatusFromLocation();
    form?.addEventListener("submit", submitAuth);
    providerButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const provider = button.dataset.provider || "github";
        const modeValue = providerMode(provider);

        if (modeValue === "unavailable") {
          if (providerAuthStatus) {
            providerAuthStatus.textContent =
              `${providerLabel(provider)} sign-in is unavailable in this environment.`;
          }
          return;
        }

        if (providerAuthStatus) {
          providerAuthStatus.textContent = `Redirecting to ${providerLabel(provider)}...`;
        }
        window.location.href = `/api/v1/auth/providers/${provider}/start`;
      });
    });
  })
  .catch((error) => {
    status.textContent =
      error instanceof Error ? error.message : "Authentication page failed to load.";
  });
