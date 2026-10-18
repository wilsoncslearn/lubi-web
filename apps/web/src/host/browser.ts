import { api } from "./vault";
export const Platform = {
  isDesktopApp: false,
  isMobileApp: false,
  isWin: navigator.platform.startsWith("Win"),
  isMacOS: /Mac/.test(navigator.platform),
};
export class FileSystemAdapter {}
export const apiVersion = "1.13.7";
export const requireApiVersion = (minimum: string) => {
  const a = apiVersion.split(".").map(Number),
    b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
};
export async function requestUrl(options: any) {
  const input = typeof options === "string" ? { url: options } : options;
  const response = await api("/network/request", {
    method: "POST",
    body: JSON.stringify({
      url: input.url,
      method: input.method || "GET",
      headers: input.headers,
      body: input.body,
    }),
  });
  if (input.throw !== false && response.status >= 400)
    throw new Error(`接口返回 HTTP ${response.status}`);
  let json: any;
  try {
    json = JSON.parse(response.text);
  } catch {
    json = null;
  }
  return {
    ...response,
    json,
    arrayBuffer: new TextEncoder().encode(response.text).buffer,
  };
}
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], {
      type: name.endsWith(".json")
        ? "application/json"
        : "text/plain;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
