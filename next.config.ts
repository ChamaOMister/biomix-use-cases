import type { NextConfig } from "next";

const codespace = process.env.CODESPACE_NAME;
const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(codespace && forwardingDomain
    ? { allowedDevOrigins: [`${codespace}-3000.${forwardingDomain}`] }
    : {}),
};

export default nextConfig;
