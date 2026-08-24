export type ModelOption = {
  id: string;
  label: string;
};

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "NVIDIA Nemotron 3 Ultra 550B" },
  { id: "openrouter/free", label: "OpenRouter Free (router)" },
  { id: "stealth/ox-alpha", label: "Ox Alpha" },
  { id: "poolside/laguna-s-2.1:free", label: "Poolside Laguna S 2.1" },
  { id: "nvidia/nemotron-3.5-lightning:free", label: "NVIDIA Nemotron 3.5 Lightning" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "NVIDIA Nemotron 3 Super 120B" },
  { id: "cohere/north-mini-code:free", label: "Cohere North Mini Code" },
  { id: "poolside/laguna-xs-2.1:free", label: "Poolside Laguna XS 2.1" },
  { id: "dots-studio/dots-3-note-preview:free", label: "Dots Studio Dots 3 Note" },
  { id: "nvidia/nemotron-3-nano-30b-a3b:free", label: "NVIDIA Nemotron 3 Nano 30B" },
  { id: "google/gemma-4-26b-a4b-it:free", label: "Google Gemma 4 26B" },
  { id: "nvidia/nemotron-nano-9b-v2:free", label: "NVIDIA Nemotron Nano 9B v2" },
  { id: "liquid/lfm-2.5-2.6b:free", label: "Liquid LFM 2.5 2.6B" },
  { id: "nvidia/nemotron-nano-12b-v2-vl:free", label: "NVIDIA Nemotron Nano 12B VL" },
  { id: "z-ai/glm-5.2:free", label: "Z-AI GLM 5.2" },
  { id: "openai/gpt-oss-20b:free", label: "OpenAI GPT-OSS 20B" },
  { id: "google/gemma-4-31b-it:free", label: "Google Gemma 4 31B" },
];

export const DEFAULT_MODEL = MODEL_OPTIONS[0].id;
