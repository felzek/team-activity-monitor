import { useModels } from "@/hooks/useModels";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function ModelSelector({ value, onChange }: Props) {
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

  if (displayModels.length === 0) {
    return (
      <select className="model-selector" disabled>
        <option>No models available — configure AI Gateway or add a provider key</option>
      </select>
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
          {m.displayName} ({m.provider})
        </option>
      ))}
    </select>
  );
}
