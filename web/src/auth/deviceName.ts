/** A name for this browser that the person will recognise in the device list, such as "Firefox on Linux". */
export function deviceName(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const system = /Windows/.test(userAgent) ? "Windows" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Android/.test(userAgent) ? "Android" : /Mac OS X|Macintosh/.test(userAgent) ? "macOS" : /Linux|X11/.test(userAgent) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}
