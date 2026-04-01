import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/api/client";
import type { GooglePickerConfig } from "@/api/types";

interface Props {
  onFolderSelected: (folderId: string, folderName: string) => void;
  onClose: () => void;
}

/**
 * Google Picker integration for folder selection.
 *
 * Loads the Google Picker API script on mount, then opens the picker
 * modal when the user clicks. Falls back to a manual folder ID input
 * if the Picker API is not available.
 */
export function GooglePickerModal({ onFolderSelected, onClose }: Props) {
  const [config, setConfig] = useState<GooglePickerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  const [manualId, setManualId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Fetch picker config
  useEffect(() => {
    apiFetch<GooglePickerConfig>("/api/v1/artifacts/google/picker-config")
      .then((cfg) => {
        setConfig(cfg);
        if (cfg.apiKey && cfg.clientId && cfg.hasToken) {
          loadPickerApi().then(() => setPickerLoaded(true)).catch(() => setPickerLoaded(false));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const openPicker = useCallback(() => {
    if (!config?.apiKey || !pickerLoaded) return;

    const google = (window as any).google;
    if (!google?.picker) {
      setError("Google Picker API not loaded");
      return;
    }

    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes("application/vnd.google-apps.folder");

    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(config.apiKey) // The backend returns the user's access token via a dedicated endpoint
      .setDeveloperKey(config.apiKey)
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const folder = data.docs[0];
          onFolderSelected(folder.id, folder.name);
        }
        if (data.action === google.picker.Action.CANCEL) {
          onClose();
        }
      })
      .setTitle("Choose a Drive folder")
      .build();

    picker.setVisible(true);
  }, [config, pickerLoaded, onFolderSelected, onClose]);

  // Auto-open picker when ready
  useEffect(() => {
    if (pickerLoaded && config?.apiKey) {
      openPicker();
    }
  }, [pickerLoaded, config, openPicker]);

  return (
    <div className="picker-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker-modal">
        <div className="picker-modal-header">
          <h3>Choose Drive Folder</h3>
          <button className="picker-close-btn" onClick={onClose}>&times;</button>
        </div>

        {loading && <div className="picker-loading">Loading Google Drive...</div>}

        {error && <div className="picker-error">{error}</div>}

        {!loading && !config?.hasToken && (
          <div className="picker-no-token">
            <p>Connect your Google account in <a href="/settings/connections">Settings</a> to use Drive.</p>
          </div>
        )}

        {!loading && config?.hasToken && !pickerLoaded && (
          <div className="picker-manual">
            <p>Enter a Google Drive folder ID manually:</p>
            <div className="picker-manual-input">
              <input
                type="text"
                placeholder="Folder ID (from Drive URL)"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualId.trim()) {
                    onFolderSelected(manualId.trim(), "Selected folder");
                  }
                }}
              />
              <button
                className="artifact-action-btn primary"
                onClick={() => {
                  if (manualId.trim()) {
                    onFolderSelected(manualId.trim(), "Selected folder");
                  }
                }}
              >
                Select
              </button>
            </div>
            <p className="picker-hint">
              Tip: Open the folder in Drive, the ID is the last part of the URL.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Load the Google Picker API script dynamically. */
function loadPickerApi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.picker) {
      resolve();
      return;
    }

    // Check if gapi script is already loaded
    if ((window as any).gapi) {
      (window as any).gapi.load("picker", { callback: resolve, onerror: reject });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () => {
      (window as any).gapi.load("picker", { callback: resolve, onerror: reject });
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
