import { Module } from "../types/course";

type ModuleItemsResponse = {
  items?: Module[] | null;
};

type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseError = {
  success: false;
  error: { flatten: () => { formErrors: string[]; fieldErrors: Record<string, string[]> } };
};

type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseError;

function makeError(formErrors: string[], fieldErrors: Record<string, string[]> = {}): SafeParseError {
  return {
    success: false,
    error: {
      flatten: () => ({ formErrors, fieldErrors }),
    },
  };
}

function isItem(value: any): boolean {
  if (!value || typeof value !== "object") return false;
  if (typeof value.item_id !== "string") return false;
  if (typeof value.type !== "string") return false;
  if (typeof value.order !== "number") return false;
  return true;
}

function isProgress(value: any): boolean {
  if (value == null) return true;
  if (typeof value !== "object") return false;
  if ("status" in value && value.status != null && typeof value.status !== "string") return false;
  if ("score" in value && value.score != null && typeof value.score !== "number") return false;
  if ("timeSpentSecs" in value && value.timeSpentSecs != null && typeof value.timeSpentSecs !== "number") return false;
  return true;
}

function isModule(value: any): value is Module {
  if (!value || typeof value !== "object") return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.title !== "string") return false;
  if (typeof value.order !== "number") return false;
  if ("unlocked" in value && typeof value.unlocked !== "boolean") return false;
  if ("itemCount" in value && value.itemCount != null && typeof value.itemCount !== "number") return false;
  if (!Array.isArray(value.items) || !value.items.every(isItem)) return false;
  if (!isProgress((value as any).progress)) return false;
  return true;
}

function parseModuleItemsResponse(input: unknown): SafeParseResult<ModuleItemsResponse> {
  if (input == null || typeof input !== "object") {
    return makeError(["Resposta deve ser um objeto"], {});
  }

  const obj = input as Record<string, unknown>;
  const result: ModuleItemsResponse = {};

  if (!("items" in obj) || obj.items == null) {
    return { success: true, data: result };
  }

  if (!Array.isArray(obj.items)) {
    return makeError([], { items: ["items deve ser um array"] });
  }

  const invalidIndex = obj.items.findIndex((item) => !isModule(item));
  if (invalidIndex >= 0) {
    return makeError([], { items: [`módulo inválido na posição ${invalidIndex}`] });
  }

  result.items = obj.items as Module[];
  return { success: true, data: result };
}

export const ModuleItemsResponseSchema = {
  safeParse(input: unknown): SafeParseResult<ModuleItemsResponse> {
    return parseModuleItemsResponse(input);
  },
};
