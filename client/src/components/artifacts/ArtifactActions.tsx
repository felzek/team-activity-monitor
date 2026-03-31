import { useState } from "react";
import { useArtifactStore } from "@/store/artifactStore";
import { ArtifactCard } from "./ArtifactCard";
import type { ArtifactSuggestion, ArtifactMetadata, ArtifactKind } from "@/api/types";

interface Props {
  suggestions: ArtifactSuggestion[];
  conversationId?: string;
  messageId?: string;
}

const BUTTON_CONFIG: Record<string, { label: string; icon: string }> = {
  google_doc:    { label: "Create Doc",      icon: "DOC"  },
  google_sheet:  { label: "Create Sheet",    icon: "XLS"  },
  google_slides: { label: "Create Slides",   icon: "PPT"  },
  chart:         { label: "Create Chart",    icon: "CHT"  },
  xlsx_export:   { label: "Export Excel",    icon: "XLS"  },
  pptx_export:   { label: "Export PowerPoint", icon: "PPT" },
};

export function ArtifactActions({ suggestions, conversationId, messageId }: Props) {
  const createArtifact = useArtifactStore((s) => s.createArtifact);
  const artifacts = useArtifactStore((s) => s.artifacts);

  /** Artifacts created from this set of suggestions, keyed by index. */
  const [createdIds, setCreatedIds] = useState<Record<number, string>>({});
  const [creating, setCreating] = useState<Record<number, boolean>>({});

  if (!suggestions || suggestions.length === 0) return null;

  const handleCreate = async (suggestion: ArtifactSuggestion, index: number) => {
    if (creating[index] || createdIds[index]) return;

    setCreating((prev) => ({ ...prev, [index]: true }));
    try {
      const meta = await createArtifact({
        kind: suggestion.kind,
        title: suggestion.title,
        spec: suggestion.spec,
        conversationId,
        messageId,
      });
      setCreatedIds((prev) => ({ ...prev, [index]: meta.id }));
    } finally {
      setCreating((prev) => ({ ...prev, [index]: false }));
    }
  };

  return (
    <div className="artifact-actions-container">
      <div className="artifact-actions-bar">
        {suggestions.map((s, i) => {
          const cfg = BUTTON_CONFIG[s.kind] ?? { label: s.kind, icon: "?" };
          const alreadyCreated = Boolean(createdIds[i]);
          const isCreating = Boolean(creating[i]);

          return (
            <button
              key={i}
              className={`artifact-suggest-btn ${alreadyCreated ? "created" : ""}`}
              onClick={() => handleCreate(s, i)}
              disabled={isCreating || alreadyCreated}
              title={s.description}
            >
              <span className="artifact-suggest-icon">{cfg.icon}</span>
              {isCreating ? "Creating..." : alreadyCreated ? "Created" : cfg.label}
            </button>
          );
        })}
      </div>

      {/* Render artifact cards for created artifacts */}
      {Object.values(createdIds).map((id) => {
        const artifact = artifacts[id];
        if (!artifact) return null;
        return <ArtifactCard key={id} artifact={artifact} />;
      })}
    </div>
  );
}
