import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", placeholder: "sk-...", docsUrl: "https://platform.openai.com/api-keys" },
  { id: "gemini", label: "Google Gemini", placeholder: "AIza...", docsUrl: "https://aistudio.google.com/apikey" },
  { id: "claude", label: "Anthropic Claude", placeholder: "sk-ant-...", docsUrl: "https://console.anthropic.com/settings/keys" },
] as const;

type ProviderId = typeof PROVIDERS[number]["id"];

interface LlmKeysResponse {
  items: Array<{ provider: string; savedAt: string }>;
}

export function LlmProviders() {
  const qc = useQueryClient();
  const refreshQueries = () => {
    void qc.invalidateQueries({ queryKey: ["llm-keys"] });
    void qc.invalidateQueries({ queryKey: ["llm-models"] });
    void qc.invalidateQueries({ queryKey: ["session"] });
  };
  const { data } = useQuery({
    queryKey: ["llm-keys"],
    queryFn: () => apiFetch<LlmKeysResponse>("/api/v1/auth/llm-keys"),
    staleTime: 30_000,
  });

  const savedProviders = new Set(data?.items?.map((k) => k.provider) ?? []);

  return (
    <div className="settings-group">
      <h3 className="settings-group-title">LLM Providers</h3>
      <p className="settings-help">
        Team Assist defaults to Vercel AI Gateway with Qwen 3.5 Flash. Add your own OpenAI, Google Gemini,
        or Anthropic keys here only if you want those models as personal overrides in the selector.
      </p>
      <div className="provider-cards">
        {PROVIDERS.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            hasSavedKey={savedProviders.has(p.id)}
            onSaved={refreshQueries}
            onRemoved={refreshQueries}
          />
        ))}
      </div>
    </div>
  );
}

interface ProviderCardProps {
  provider: typeof PROVIDERS[number];
  hasSavedKey: boolean;
  onSaved: () => void;
  onRemoved: () => void;
}

function ProviderCard({ provider, hasSavedKey, onSaved, onRemoved }: ProviderCardProps) {
  const [keyInput, setKeyInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (key: string) =>
      apiFetch(`/api/v1/auth/llm-keys/${provider.id}`, {
        method: "PUT",
        body: JSON.stringify({ apiKey: key }),
      }),
    onSuccess: () => { setStatus("Key saved."); setKeyInput(""); onSaved(); },
    onError: (e: Error) => setStatus(`Error: ${e.message}`),
  });

  const remove = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/auth/llm-keys/${provider.id}`, { method: "DELETE" }),
    onSuccess: () => { setStatus("Key removed."); onRemoved(); },
    onError: (e: Error) => setStatus(`Error: ${e.message}`),
  });

  return (
    <div className="provider-card">
      <div className="provider-card-header">
        <h4>{provider.label}</h4>
        <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" className="get-key-link">
          Get key ↗
        </a>
      </div>
      {hasSavedKey ? (
        <div className="provider-key-saved">
          <span className="key-saved-badge">● Key saved</span>
          <button className="btn-ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Remove
          </button>
        </div>
      ) : (
        <div className="provider-key-form">
          <input
            type="password"
            className="key-input"
            placeholder={provider.placeholder}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoComplete="off"
          />
          <button
            className="btn-primary"
            onClick={() => keyInput.trim() && save.mutate(keyInput.trim())}
            disabled={!keyInput.trim() || save.isPending}
          >
            Save key
          </button>
        </div>
      )}
      {status && <p className="settings-status">{status}</p>}
    </div>
  );
}
