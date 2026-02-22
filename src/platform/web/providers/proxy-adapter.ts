import { NeonServerlessAdapter } from "./neon-adapter";

function withProxyToken(
  wsProxyEndpoint: string | undefined,
  accessToken: string | undefined,
): string | undefined {
  if (!wsProxyEndpoint || !accessToken) {
    return wsProxyEndpoint;
  }

  const endpoint = wsProxyEndpoint.trim();

  if (endpoint.length === 0 || /[?&]token=/i.test(endpoint)) {
    return endpoint;
  }

  if (/^wss?:\/\//i.test(endpoint) || /^https?:\/\//i.test(endpoint)) {
    const parsed = new URL(endpoint);
    parsed.searchParams.set("token", accessToken);
    return parsed.toString();
  }

  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}token=${encodeURIComponent(accessToken)}`;
}

export class ProxyAdapter extends NeonServerlessAdapter {
  constructor(
    connectionString: string,
    wsProxyEndpoint?: string,
    accessToken?: string,
  ) {
    super(connectionString, withProxyToken(wsProxyEndpoint, accessToken));
  }
}
