export function jwt(payload: Record<string, unknown>): string {
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `eyJhbGciOiJub25lIn0.${body}.sig`;
}

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export function discoveryDocument(): Record<string, string> {
	return {
		authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
		token_endpoint: "https://auth.x.ai/oauth2/token",
		device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
		userinfo_endpoint: "https://auth.x.ai/oauth2/userinfo",
	};
}
