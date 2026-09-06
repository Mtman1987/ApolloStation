export interface StreamWeaverFlowCodeContextV1 {
  message: string;
  args: string[];
  userName: string;
  user: string;
  targetUser: string;
  lastOutput: string;
  vars: Record<string, string>;
}

type FlowCodeValue = string | number | boolean | null | FlowCodeValue[];
interface Stage { name: string; args: string[]; }

const MAX_EXPRESSION_LENGTH = 4_000;
const MAX_STAGES = 32;
const MAX_ARGUMENTS = 16;
const MAX_VALUE_LENGTH = 16_000;
const MAX_ARRAY_ITEMS = 256;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_NAMES = new Set(["constructor","prototype","__proto__"]);
const OPERATIONS = new Set([
  "trim", "lower", "upper", "string", "number", "length", "add", "subtract", "multiply", "divide", "mod",
  "abs", "round", "floor", "ceil", "min", "max", "contains", "startsWith", "endsWith", "replace", "slice",
  "split", "join", "pick", "default", "json",
]);

/**
 * Flow Code is deliberately not JavaScript. It is a deterministic, side-effect-free
 * value pipeline used inside ordinary StreamWeaver templates: {{= argsText | trim | upper }}.
 * It cannot access network, files, credentials, globals, prototypes, eval, or arbitrary functions.
 */
export function renderFlowCodeExpression(source: string, context: StreamWeaverFlowCodeContextV1): string {
  const pipeline = parsePipeline(source);
  let value = bounded(resolveAtom(pipeline.source, context));
  for (const stage of pipeline.stages) value = bounded(applyStage(stage, value, context));
  return output(value);
}

export function assertFlowCodeValue(value: unknown): void {
  if (typeof value === "string") {
    const matches = [...value.matchAll(/\{\{\s*=\s*([^{}]+?)\s*\}\}/g)];
    const residue=value.replace(/\{\{\s*=\s*([^{}]+?)\s*\}\}/g,"");
    if (residue.includes("{{=")) throw new Error("Flow Code expression is not closed correctly");
    for (const match of matches) parsePipeline(match[1] ?? "");
    return;
  }
  if (Array.isArray(value)) { for (const item of value) assertFlowCodeValue(item); return; }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) assertFlowCodeValue(item);
}

function parsePipeline(source: string): { source: string; stages: Stage[] } {
  const expression = source.trim();
  if (!expression || expression.length > MAX_EXPRESSION_LENGTH || /[\r\n\0]/.test(expression)) throw new Error("Flow Code must be one expression up to 4000 characters");
  const parts = splitTopLevel(expression, "|");
  if (!parts.length || parts.length > MAX_STAGES + 1) throw new Error("Flow Code has too many pipeline stages");
  validateAtom(parts[0]!);
  return { source: parts[0]!, stages: parts.slice(1).map(parseStage) };
}

function parseStage(source: string): Stage {
  const text = source.trim(), match = /^([A-Za-z][A-Za-z0-9]*)(?:\((.*)\))?$/.exec(text);
  if (!match || !OPERATIONS.has(match[1]!)) throw new Error(`Unsupported Flow Code operation: ${text.slice(0, 80)}`);
  const args = match[2] === undefined || !match[2].trim() ? [] : splitTopLevel(match[2], ",");
  if (args.length > MAX_ARGUMENTS) throw new Error("Flow Code operation has too many arguments");
  for (const arg of args) validateAtom(arg);
  validateArity(match[1]!, args.length);
  return { name: match[1]!, args };
}

function validateArity(name: string, count: number) {
  const zero = ["trim","lower","upper","string","number","length","abs","round","floor","ceil","json"];
  if (zero.includes(name) && count !== 0) throw new Error(`${name}() does not take arguments`);
  const one = ["add","subtract","multiply","divide","mod","contains","startsWith","endsWith","split","join","pick","default"];
  if (one.includes(name) && count !== 1) throw new Error(`${name}() requires one argument`);
  if (name === "replace" && count !== 2) throw new Error("replace() requires search and replacement arguments");
  if (name === "slice" && (count < 1 || count > 2)) throw new Error("slice() requires start and optional end arguments");
  if ((name === "min" || name === "max") && count < 1) throw new Error(`${name}() requires at least one comparison value`);
}

function validateAtom(source: string): void {
  const atom = source.trim();
  if (!atom) throw new Error("Flow Code contains an empty value");
  if (isQuoted(atom) || /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(atom) || /^(?:true|false|null)$/.test(atom)) return;
  if (["message","argsText","userName","user","targetUser","lastOutput"].includes(atom)) return;
  if (/^args\[\d{1,3}\]$/.test(atom) || /^arg\d{1,3}$/.test(atom)) return;
  const variable = /^vars\.([A-Za-z][A-Za-z0-9_]{0,63})$/.exec(atom);
  if (variable && SAFE_NAME.test(variable[1]!)&&!FORBIDDEN_NAMES.has(variable[1]!)) return;
  throw new Error(`Unsupported Flow Code value: ${atom.slice(0, 80)}`);
}

function resolveAtom(source: string, context: StreamWeaverFlowCodeContextV1): FlowCodeValue {
  const atom = source.trim();
  if (isQuoted(atom)) return quoted(atom);
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(atom)) return Number(atom);
  if (atom === "true") return true;
  if (atom === "false") return false;
  if (atom === "null") return null;
  if (atom === "message") return context.message;
  if (atom === "argsText") return context.args.join(" ");
  if (atom === "userName") return context.userName;
  if (atom === "user") return context.user;
  if (atom === "targetUser") return context.targetUser;
  if (atom === "lastOutput") return context.lastOutput;
  const arg = /^args\[(\d{1,3})\]$/.exec(atom) ?? /^arg(\d{1,3})$/.exec(atom);
  if (arg) return context.args[Number(arg[1])] ?? "";
  const variable = /^vars\.([A-Za-z][A-Za-z0-9_]{0,63})$/.exec(atom);
  if (variable) return Object.hasOwn(context.vars, variable[1]!) ? context.vars[variable[1]!] ?? "" : "";
  throw new Error("Flow Code value is unavailable");
}

function applyStage(stage: Stage, current: FlowCodeValue, context: StreamWeaverFlowCodeContextV1): FlowCodeValue {
  const args = stage.args.map((arg) => resolveAtom(arg, context));
  switch (stage.name) {
    case "trim": return text(current).trim();
    case "lower": return text(current).toLowerCase();
    case "upper": return text(current).toUpperCase();
    case "string": return text(current);
    case "number": return finite(current);
    case "length": return Array.isArray(current) ? current.length : text(current).length;
    case "add": return finite(current) + finite(args[0]);
    case "subtract": return finite(current) - finite(args[0]);
    case "multiply": return finite(current) * finite(args[0]);
    case "divide": { const divisor = finite(args[0]); if (divisor === 0) throw new Error("Flow Code cannot divide by zero"); return finite(current) / divisor; }
    case "mod": { const divisor = finite(args[0]); if (divisor === 0) throw new Error("Flow Code cannot divide by zero"); return finite(current) % divisor; }
    case "abs": return Math.abs(finite(current));
    case "round": return Math.round(finite(current));
    case "floor": return Math.floor(finite(current));
    case "ceil": return Math.ceil(finite(current));
    case "min": return Math.min(finite(current), ...args.map(finite));
    case "max": return Math.max(finite(current), ...args.map(finite));
    case "contains": return text(current).includes(text(args[0]));
    case "startsWith": return text(current).startsWith(text(args[0]));
    case "endsWith": return text(current).endsWith(text(args[0]));
    case "replace": {
      const input=text(current),search=text(args[0]),replacement=text(args[1]);
      const occurrences=search===""?input.length+1:countOccurrences(input,search);
      const projected=input.length-occurrences*search.length+occurrences*replacement.length;
      if(projected>MAX_VALUE_LENGTH)throw new Error("Flow Code value exceeds the safe output limit");
      return input.replaceAll(search,replacement);
    }
    case "slice": return (Array.isArray(current) ? current : text(current)).slice(integer(args[0]), args.length > 1 ? integer(args[1]) : undefined) as FlowCodeValue;
    case "split": return text(current).split(text(args[0])).slice(0, MAX_ARRAY_ITEMS);
    case "join": return Array.isArray(current) ? current.map(text).join(text(args[0])) : text(current);
    case "pick": return Array.isArray(current) ? current[integer(args[0])] ?? "" : text(current).charAt(integer(args[0]));
    case "default": return current === null || current === "" ? args[0] ?? "" : current;
    case "json": return JSON.stringify(current);
    default: throw new Error("Unsupported Flow Code operation");
  }
}

function splitTopLevel(source: string, delimiter: "|" | ","): string[] {
  const result: string[] = [];
  let start = 0, quote = "", escaped = false, depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") { depth += 1; continue; }
    if (char === ")") { depth -= 1; if (depth < 0) throw new Error("Flow Code has an unmatched parenthesis"); continue; }
    if (char === delimiter && depth === 0) { result.push(source.slice(start, index).trim()); start = index + 1; }
  }
  if (quote || depth !== 0) throw new Error("Flow Code has an unterminated string or parenthesis");
  result.push(source.slice(start).trim());
  return result;
}

function isQuoted(value: string) { return value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'")); }
function quoted(value: string) {
  const body = value.slice(1, -1);
  if (value[0] === '"') { try { return JSON.parse(value) as string; } catch { throw new Error("Flow Code string literal is invalid"); } }
  return body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}
function text(value: FlowCodeValue | undefined): string { if (value === null || value === undefined) return ""; return Array.isArray(value) ? value.map(text).join(",") : String(value); }
function finite(value: FlowCodeValue | undefined): number { const result = Number(Array.isArray(value) ? text(value) : value); if (!Number.isFinite(result)) throw new Error("Flow Code expected a finite number"); return result; }
function integer(value: FlowCodeValue | undefined): number { const result = finite(value); if (!Number.isSafeInteger(result)) throw new Error("Flow Code expected an integer"); return result; }
function output(value: FlowCodeValue): string { return Array.isArray(value) ? JSON.stringify(value) : value === null ? "" : String(value); }
function bounded(value:FlowCodeValue):FlowCodeValue {
  if(Array.isArray(value)){
    if(value.length>MAX_ARRAY_ITEMS)throw new Error("Flow Code array exceeds the safe item limit");
    let size=0;for(const item of value){size+=text(item).length;if(size>MAX_VALUE_LENGTH)throw new Error("Flow Code value exceeds the safe output limit");}
    return value;
  }
  if(typeof value==="string"&&value.length>MAX_VALUE_LENGTH)throw new Error("Flow Code value exceeds the safe output limit");
  return value;
}
function countOccurrences(value:string,search:string){let count=0,at=0;while((at=value.indexOf(search,at))!==-1){count++;at+=search.length;}return count;}
