import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Where "next dev" forwards API calls: the Express server started with "npm start".
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3000";

// Tailwind is compiled by this loader (set up by create-next-app).
const turbopack: NextConfig["turbopack"] = {
  rules: {
    "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
  },
};

// "next build" writes the page as plain files into out/, and the Express server serves
// that folder. No Next.js server runs when the app is used.
const buildConfig: NextConfig = { output: "export", turbopack };

// "next dev" is only for working on the page, with hot reload. A static export cannot
// forward requests, so this forwarding exists in development only.
const devConfig: NextConfig = {
  turbopack,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default function config(phase: string): NextConfig {
  return phase === PHASE_DEVELOPMENT_SERVER ? devConfig : buildConfig;
}
