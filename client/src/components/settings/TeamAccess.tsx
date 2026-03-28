import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useSessionStore } from "@/store/sessionStore";

interface Member {
  id: string;
  displayName: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  inviteUrl: string;
}

export function TeamAccess() {
  const { currentOrgId } = useSessionStore();
  const qc = useQueryClient();

  const membersQ = useQuery({
    queryKey: ["members", currentOrgId],
    queryFn: () => apiFetch<{ members: Member[] }>(`/api/v1/orgs/${currentOrgId}/members`),
    enabled: !!currentOrgId,
    select: (d) => d.members,
  });

  const invitesQ = useQuery({
    queryKey: ["invites", currentOrgId],
    queryFn: () => apiFetch<{ invitations: Invitation[] }>(`/api/v1/orgs/${currentOrgId}/invitations`),
    enabled: !!currentOrgId,
    select: (d) => d.invitations,
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () =>
      apiFetch<{ invitation: Invitation; emailSent: boolean }>(`/api/v1/orgs/${currentOrgId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: (data) => {
      setEmail("");
      setInviteStatus(
        data.emailSent
          ? "Invitation sent! Check their inbox."
          : "Invitation created. Share the link manually (email sending not configured)."
      );
      void qc.invalidateQueries({ queryKey: ["invites"] });
    },
    onError: (e: Error) => setInviteStatus(`Error: ${e.message}`),
  });

  return (
    <div>
      <div className="settings-group">
        <h3 className="settings-group-title">Members</h3>
        {membersQ.isLoading ? (
          <p className="settings-help">Loading…</p>
        ) : membersQ.data?.length === 0 ? (
          <p className="settings-help">No members yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
              <tbody>
                {membersQ.data?.map((m) => (
                  <tr key={m.id}>
                    <td>{m.displayName}</td>
                    <td>{m.email}</td>
                    <td><span className="role-badge">{m.role}</span></td>
                    <td>{new Date(m.joinedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Invite a teammate</h3>
        <div className="invite-form">
          <label className="stacked-field">
            <span className="field-label">Email</span>
            <input
              type="email"
              className="text-input"
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="stacked-field">
            <span className="field-label">Role</span>
            <select className="select-input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="support">Support</option>
            </select>
          </label>
          <button
            className="btn-primary"
            onClick={() => invite.mutate()}
            disabled={!email.trim() || invite.isPending}
          >
            Create invite
          </button>
        </div>
        {inviteStatus && <p className="settings-status">{inviteStatus}</p>}

        {(invitesQ.data?.length ?? 0) > 0 && (
          <div style={{ marginTop: 16 }}>
            <p className="field-label" style={{ marginBottom: 8 }}>Pending invitations</p>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th></th></tr></thead>
                <tbody>
                  {invitesQ.data?.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.email}</td>
                      <td>{inv.role}</td>
                      <td>{new Date(inv.expiresAt).toLocaleDateString()}</td>
                      <td>
                        <button
                          className="btn-ghost"
                          onClick={() => {
                            void navigator.clipboard.writeText(inv.inviteUrl);
                          }}
                          title="Copy invite link"
                        >
                          Copy link
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
