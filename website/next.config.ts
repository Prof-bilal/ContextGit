import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

// Keep the website hermetic when the repository also contains the desktop
// package and its separate lockfile.
nextConfig.turbopack = { root: __dirname };

export default nextConfig;
