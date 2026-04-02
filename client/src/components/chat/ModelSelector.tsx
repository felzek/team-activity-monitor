import { useModels } from "@/hooks/useModels";
import type { LlmModel } from "@/api/types";
import { useSessionStore } from "@/store/sessionStore";

interface Props {
  value: string;
  onChange: (id: string) => void;
  locked?: boolean;
  onLockedClick?: () => void;
}

type DirectProvider = Extract<LlmModel["provider"], "openai" | "claude" | "gemini">;

interface DisplayModel extends LlmModel {
  disabled?: boolean;
}

const LOCKED_PROVIDER_MODELS: Record<DirectProvider, DisplayModel[]> = {
  openai: [
    {
      id: "openai:gpt-5.4",
      provider: "openai",
      providerModelId: "gpt-5.4",
      displayName: "GPT-5.4",
      supportsChat: true,
      supportsStreaming: true,
      supportsTools: true,
      supportsVision: true,
      status: "unavailable",
      isDefaultCandidate: false,
      isPinned: false,
      sortOrder: 5,
      disabled: true,
    },
  ],
  claude: [
    {
      id: "claude:claude-sonnet-4-6-20251022",
      provider: "claude",
      providerModelId: "claude-sonnet-4-6-20251022",
      displayName: "Claude Sonnet 4.6",
      supportsChat: true,
      supportsStreaming: true,
      supportsTools: true,
      supportsVision: true,
      status: "unavailable",
      isDefaultCandidate: false,
      isPinned: false,
      sortOrder: 10,
      disabled: true,
    },
  ],
  gemini: [
    {
      id: "gemini:models/gemini-2.0-flash-001",
      provider: "gemini",
      providerModelId: "models/gemini-2.0-flash-001",
      displayName: "Gemini 2.0 Flash",
      supportsChat: true,
      supportsStreaming: true,
      supportsTools: true,
      supportsVision: true,
      status: "unavailable",
      isDefaultCandidate: false,
      isPinned: false,
      sortOrder: 30,
      disabled: true,
    },
  ],
};

function providerLabel(provider: LlmModel["provider"]): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    case "gateway":
      return "AI Gateway";
    case "local":
      return "Local";
    default:
      return provider;
  }
}

function optionLabel(model: LlmModel, duplicateNames: Set<string>): string {
  if (!duplicateNames.has(model.displayName)) {
    return model.displayName;
  }

  return `${model.displayName} (${providerLabel(model.provider)})`;
}

export function ModelSelector({ value, onChange, locked = false, onLockedClick }: Props) {
  const { data: models, isLoading } = useModels();
  const authenticated = useSessionStore((state) => state.authenticated);
  const connectedLlmProviders = useSessionStore((state) => state.connectedLlmProviders);

  if (isLoading) {
    return (
      <select className="model-selector" disabled>
        <option>Loading models…</option>
      </select>
    );
  }

  const availableModels = models ?? [];
  const visibleProviders = new Set(availableModels.map((model) => model.provider));
  const disconnectedProviderModels = authenticated
    ? (["openai", "claude", "gemini"] as const)
        .filter(
          (provider) =>
            !connectedLlmProviders.includes(provider) &&
            !visibleProviders.has(provider)
        )
        .flatMap((provider) => LOCKED_PROVIDER_MODELS[provider])
    : [];
  const displayModels: DisplayModel[] = [...availableModels, ...disconnectedProviderModels];
  const duplicateNames = new Set(
    displayModels
      .map((model) => model.displayName)
      .filter((name, index, all) => all.indexOf(name) !== index)
  );

  if (displayModels.length === 0) {
    return (
      <select className="model-selector" disabled>
        <option>No models available — configure AI Gateway or add a provider key</option>
      </select>
    );
  }

  if (locked) {
    const activeModel =
      displayModels.find((model) => model.id === value) ??
      displayModels.find((model) => !model.disabled && model.status === "available") ??
      displayModels[0];

    return (
      <button
        type="button"
        className="model-selector model-selector--locked"
        onClick={onLockedClick}
      >
        {activeModel.displayName}
        <span className="model-selector-lock">Sign in to switch</span>
      </button>
    );
  }

  return (
    <select
      className="model-selector"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {displayModels.map((m) => (
        <option
          key={m.id}
          value={m.id}
          disabled={m.disabled || m.status !== "available"}
        >
          {m.status === "available"
            ? optionLabel(m, duplicateNames)
            : `${optionLabel(m, duplicateNames)} — add ${providerLabel(m.provider)} key`}
        </option>
      ))}
    </select>
  );
}
