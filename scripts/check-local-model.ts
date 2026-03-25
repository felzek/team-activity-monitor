import { loadAppConfig } from "../src/config.js";

interface OllamaListModelsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

function ollamaUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

async function main() {
  const config = loadAppConfig({
    ...process.env,
    USE_RECORDED_FIXTURES: "true"
  });

  const tagsResponse = await fetch(ollamaUrl(config.ollamaBaseUrl, "tags"), {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!tagsResponse.ok) {
    throw new Error(
      `Could not reach Ollama at ${config.ollamaBaseUrl}. Start Ollama before running this check.`
    );
  }

  const tagsPayload = (await tagsResponse.json()) as OllamaListModelsResponse;
  const availableModels = (tagsPayload.models ?? []).flatMap((model) =>
    [model.name, model.model].filter((value): value is string => Boolean(value))
  );

  if (!availableModels.includes(config.ollamaModel)) {
    throw new Error(
      `Configured model "${config.ollamaModel}" is not installed. Available models: ${availableModels.join(", ") || "none"}.`
    );
  }

  const chatResponse = await fetch(ollamaUrl(config.ollamaBaseUrl, "chat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      keep_alive: config.ollamaKeepAlive,
      messages: [
        {
          role: "system",
          content: "Reply with exactly READY."
        },
        {
          role: "user",
          content: "ping"
        }
      ]
    })
  });

  if (!chatResponse.ok) {
    throw new Error(
      `Ollama chat check failed with status ${chatResponse.status}. Confirm the model is usable.`
    );
  }

  const chatPayload = (await chatResponse.json()) as OllamaChatResponse;

  console.log(
    JSON.stringify(
      {
        ok: true,
        ollamaBaseUrl: config.ollamaBaseUrl,
        ollamaModel: config.ollamaModel,
        response: chatPayload.message?.content?.trim() ?? ""
      },
      null,
      2
    )
  );
}

void main();
