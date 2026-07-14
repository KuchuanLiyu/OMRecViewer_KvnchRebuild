import { reactive } from "vue";

export interface LogEntry {
  time: string;
  msg: string;
  ok: boolean | null; // true=ok, false=fail, null=info
}

export const logBus = reactive<LogEntry[]>([]);

export function logInfo(msg: string) {
  logBus.push({ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), msg, ok: null });
  if (logBus.length > 50) logBus.shift();
}

export function logOk(msg: string) {
  logBus.push({ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), msg, ok: true });
  if (logBus.length > 50) logBus.shift();
}

export function logFail(msg: string) {
  logBus.push({ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), msg, ok: false });
  if (logBus.length > 50) logBus.shift();
}
