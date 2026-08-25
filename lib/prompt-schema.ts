import { objectFromUnknown, toText } from "./schema-utils";

export type PromptData = {
  title: string;
  prompt: string;
};

export type PromptRow = PromptData & { id: string };

export const PROMPT_TITLE_MAX = 80;
export const PROMPT_BODY_MAX = 4000;

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function promptFromUnknown(input: unknown): PromptData {
  const map = objectFromUnknown(input);

  return {
    title: clamp(toText(map.title), PROMPT_TITLE_MAX),
    prompt: clamp(toText(map.prompt), PROMPT_BODY_MAX),
  };
}
