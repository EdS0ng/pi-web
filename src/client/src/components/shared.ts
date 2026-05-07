import { css } from "lit";

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; toolName: string; summary: string }
  | { type: "toolResult"; toolName: string; text: string; isError: boolean }
  | { type: "empty" };

export interface ChatLine {
  role: "user" | "assistant" | "tool" | "system";
  parts: ChatPart[];
}

export const appStyles = css`
  :host { display: block; height: 100vh; color: #e6edf3; background: #0d1117; font: 14px system-ui, sans-serif; }
  .shell { display: grid; grid-template-columns: 340px 1fr; height: 100%; min-height: 0; }
  aside { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid #30363d; overflow: hidden; }
  header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #30363d; }
  project-list, workspace-list { flex: 0 0 auto; max-height: 26%; overflow: auto; border-bottom: 1px solid #21262d; }
  session-list { flex: 1 1 auto; min-height: 0; overflow: auto; }
  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  chat-view { flex: 1 1 auto; min-height: 0; overflow: auto; }
  chat-composer { flex: 0 0 auto; }
  button { border: 1px solid #30363d; border-radius: 8px; background: #161b22; color: #e6edf3; padding: 7px 9px; cursor: pointer; }
  .empty { margin: auto; color: #8b949e; }
  .error { padding: 10px 16px; border-bottom: 1px solid #30363d; color: #ff7b72; }
`;

export const listStyles = css`
  :host { display: block; color: #e6edf3; font: 14px system-ui, sans-serif; }
  section { padding: 10px; }
  h2 { display: flex; justify-content: space-between; align-items: center; margin: 0 0 8px; color: #8b949e; font-size: 12px; text-transform: uppercase; }
  button { border: 1px solid #30363d; border-radius: 8px; background: #161b22; color: #e6edf3; padding: 7px 9px; cursor: pointer; }
  section > button { display: block; width: 100%; text-align: left; margin: 6px 0; }
  button.selected { border-color: #58a6ff; background: #0d2847; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  small { display: block; color: #8b949e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export const chatStyles = css`
  :host { display: block; min-height: 0; color: #e6edf3; font: 14px system-ui, sans-serif; }
  .chat { height: 100%; overflow: auto; padding: 16px; box-sizing: border-box; }
  .msg { margin: 0 0 14px; padding: 12px; border: 1px solid #30363d; border-radius: 10px; background: #161b22; }
  .msg.user { border-color: #2f81f7; background: #0d2847; }
  .msg.tool { border-color: #6e5200; background: #1f1a10; color: #d29922; }
  .msg.system { color: #ff7b72; }
  .label { display: block; margin-bottom: 8px; color: #8b949e; font-size: 12px; text-transform: uppercase; }
  formatted-text.part { display: block; }
  .part + .part { margin-top: 10px; }
  .tool-line { color: #d29922; }
  .summary { color: #8b949e; margin-left: 6px; }
  details { border-top: 1px solid #30363d; padding-top: 8px; }
  summary { cursor: pointer; color: #8b949e; }
  pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
`;

export const formattedTextStyles = css`
  :host { display: block; }
  .formatted { white-space: normal; overflow-wrap: anywhere; line-height: 1.45; }
  p, ul, ol, pre, blockquote, table { margin: 0 0 10px; }
  :is(p, ul, ol, pre, blockquote, table):last-child { margin-bottom: 0; }
  ul, ol { padding-left: 22px; }
  li + li { margin-top: 3px; }
  code { border: 1px solid #30363d; border-radius: 4px; background: #0d1117; padding: 1px 4px; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { border: 1px solid #30363d; border-radius: 8px; background: #0d1117; padding: 10px; overflow: auto; }
  pre code { border: 0; padding: 0; background: transparent; }
  blockquote { border-left: 3px solid #30363d; padding-left: 10px; color: #8b949e; }
  a { color: #58a6ff; }
  h1, h2, h3, h4 { margin: 14px 0 8px; line-height: 1.2; }
  h1:first-child, h2:first-child, h3:first-child, h4:first-child { margin-top: 0; }
  h1 { font-size: 20px; }
  h2 { font-size: 17px; }
  h3 { font-size: 15px; }
  h4 { font-size: 14px; }
  table { border-collapse: collapse; display: block; overflow: auto; }
  th, td { border: 1px solid #30363d; padding: 4px 8px; }
  th { background: #161b22; }
`;

export const composerStyles = css`
  :host { display: block; color: #e6edf3; font: 14px system-ui, sans-serif; }
  footer { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; padding: 12px; border-top: 1px solid #30363d; }
  textarea { min-height: 54px; resize: vertical; border-radius: 8px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; padding: 8px; }
  button { border: 1px solid #30363d; border-radius: 8px; background: #161b22; color: #e6edf3; padding: 7px 9px; cursor: pointer; }
  button:disabled, textarea:disabled { opacity: .5; cursor: not-allowed; }
`;
