export const SESSION_HEADER = "X-Session-Id";
export const USER_HEADER = "X-User-Name";
export const SESSION_ID_PATTERN = /^[\w-]{8,64}$/;

export const ANONYMOUS_USER = "anonymous";
export const MAX_USER_NAME_LENGTH = 40;
export const MAX_MESSAGE_LENGTH = 500;
export const JSON_BODY_LIMIT = "10kb";

// The names this machine is opened by in a browser. A request for any other name is refused.
export const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
