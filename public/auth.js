const form = document.getElementById("auth-form");
const status = document.getElementById("auth-status");
const mode = form?.dataset.mode || "login";
const organizationField = document.getElementById("organization-field");
const invitationPanel = document.getElementById("invitation-panel");
const invitationMessage = document.getElementById("invitation-message");
const inviteTokenInput = document.getElementById("invite-token");

let csrfToken = null;

async function loadSession() {
  const response = await fetch("/api/v1/auth/session");
  const payload = await response.json();
  csrfToken = payload.csrfToken;

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
    form?.addEventListener("submit", submitAuth);
  })
  .catch((error) => {
    status.textContent =
      error instanceof Error ? error.message : "Authentication page failed to load.";
  });
