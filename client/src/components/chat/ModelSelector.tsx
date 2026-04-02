import { useModels } from "@/hooks/useModels";
import type { LlmModel } from "@/api/types";

interface Props {
  value: string;
  onChange: (id: string) => void;
  locked?: boolean;
  onLockedClick?: () => void;
}

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

  if (isLoading) {
    return (
      <select className="model-selector" disabled>
        <option>Loading models…</option>
      </select>
    );
  }

  const toolModels = models?.filter((m) => m.supportsTools) ?? [];
  const displayModels = toolModels.length > 0 ? toolModels : (models ?? []);
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
        <option key={m.id} value={m.id}>
          {optionLabel(m, duplicateNames)}
        </option>
      ))}
    </select>
  );
}
