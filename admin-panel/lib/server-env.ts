/**
 * THE single place the panel's server code reads environment
 * credentials from (the backend URL and the two shared secrets).
 * Values live only in the panel project's environment; this module
 * is the map of what exists. Client code keeps reading
 * NEXT_PUBLIC_* Firebase web config directly — that is public
 * configuration, not credentials.
 */
function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

export const serverEnv = {
  get backendUrl() {
    return read("BACKEND_URL").replace(/\/+$/, "");
  },
  get backendServiceToken() {
    return read("BACKEND_SERVICE_TOKEN");
  },
  get adminApiSecret() {
    return read("ADMIN_API_SECRET");
  },
};
