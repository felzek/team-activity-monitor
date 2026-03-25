const form = document.getElementById("auth-form");
const status = document.getElementById("auth-status");
const mode = form?.dataset.mode || "login";
const organizationField = document.getElementById("organization-field");
const invitationPanel = document.getElementById("invitation-panel");
const invitationMessage = document.getElementById("invitation-message");
const inviteTokenInput = document.getElementById("invite-token");
const providerAuthPanel = document.getElementById("provider-auth-panel");
const providerAuthForm = document.getElementById("provider-auth-form");
const providerAuthStatus = document.getElementById("provider-auth-status");
const providerAuthNote = document.getElementById("provider-auth-note");
const providerAuthSubmit = document.getElementById("provider-auth-submit");
const providerAuthInput = document.getElementById("provider-auth-input");
const providerEmailInput = document.getElementById("provider-email");
const providerButtons = Array.from(document.querySelectorAll(".provider-button"));

let csrfToken = null;
let providerAuthState = {
  mode: "demo",
  providerModes: {
    github: "demo",
    jira: "demo",
    google: "demo"
  }
};
let selectedProvider = "github";

function providerLabel(provider) {
  if (provider === "jira") return "Jira";
  if (provider === "google") return "Google";
  return "GitHub";
}

function providerMode(provider) {
  return providerAuthState?.providerModes?.[provider] || "demo";
}

function setProviderSelection(provider) {
  selectedProvider = provider;

  if (!providerAuthForm) {
    return;
  }

  providerAuthInput.value = provider;
  providerAuthSubmit.textContent = `Continue with ${providerLabel(provider)}`;
  providerAuthForm.classList.remove("hidden");
  providerAuthForm.dataset.provider = provider;
  providerButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.provider === provider);
  });

  const loginEmail = form?.elements?.email?.value?.trim?.();
  if (loginEmail && providerEmailInput && !providerEmailInput.value) {
    providerEmailInput.value = loginEmail;
  }

  providerAuthStatus.textContent = `Ready to continue with ${providerLabel(provider)}.`;
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
    button.textContent =
      modeValue === "unavailable"
        ? `${providerLabel(provider)} unavailable`
        : `Continue with ${providerLabel(provider)}`;
  });

  const allModes = ["github", "jira", "google"].map(providerMode);
  const hasOAuth = allModes.includes("oauth");
  const hasDemo = allModes.includes("demo");
  const allUnavailable = allModes.every((m) => m === "unavailable");

  if (allUnavailable) {
    providerAuthNote.textContent =
      "Provider sign-in requires OAuth configuration for at least one provider.";
  } else if (hasOAuth && !hasDemo) {
    providerAuthNote.textContent =
      "Choose a provider to sign in through their OAuth flow.";
  } else if (hasOAuth && hasDemo) {
    providerAuthNote.textContent =
      "Some providers use real OAuth, others use demo sign-in for this environment.";
  } else {
    providerAuthNote.textContent =
      "In this local environment, provider sign-in creates or resumes your account and connects the selected provider in one step.";
  }

  if (providerMode(selectedProvider) !== "demo") {
    providerAuthForm?.classList.add("hidden");
  }
}

function applyProviderAuthStatusFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("provider_auth");
  const provider = params.get("provider");
  const message = params.get("message");

  if (outcome !== "error") {
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

async function submitProviderAuth(event) {
  event.preventDefault();

  const provider = providerAuthInput.value || selectedProvider;

  if (providerMode(provider) !== "demo") {
    providerAuthStatus.textContent =
      "Use the provider button above to start OAuth in this environment.";
    return;
  }

  const formData = new FormData(providerAuthForm);
  const payload = Object.fromEntries(formData.entries());

  providerAuthStatus.textContent = `Signing in with ${providerLabel(provider)}...`;

  try {
    const response = await fetch(`/api/v1/auth/providers/${provider}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken || ""
      },
      body: JSON.stringify(payload)
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.error || "Provider sign-in failed.");
    }

    providerAuthStatus.textContent = "Success. Redirecting...";
    window.location.href = "/app";
  } catch (error) {
    providerAuthStatus.textContent =
      error instanceof Error ? error.message : "Unexpected provider sign-in error.";
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

        if (modeValue === "oauth") {
          providerAuthStatus.textContent = `Redirecting to ${providerLabel(provider)}...`;
          window.location.href = `/api/v1/auth/providers/${provider}/start`;
          return;
        }

        if (modeValue === "unavailable") {
          providerAuthStatus.textContent =
            `${providerLabel(provider)} sign-in is unavailable in this environment.`;
          return;
        }

        setProviderSelection(provider);
      });
    });
    providerAuthForm?.addEventListener("submit", submitProviderAuth);
  })
  .catch((error) => {
    status.textContent =
      error instanceof Error ? error.message : "Authentication page failed to load.";
  });
