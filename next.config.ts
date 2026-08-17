import type { NextConfig } from "vinext";

const DEFAULT_GITHUB_REPOSITORY = "mastering-your-phd-zh";

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") {
    return "";
  }

  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function githubPagesBasePath(): string {
  if (process.env.GITHUB_PAGES_BASE_PATH !== undefined) {
    return normalizeBasePath(process.env.GITHUB_PAGES_BASE_PATH);
  }

  const repositoryName =
    process.env.GITHUB_REPOSITORY?.split("/").at(-1) ??
    DEFAULT_GITHUB_REPOSITORY;

  // User/organization Pages repositories are hosted at the domain root.
  if (repositoryName.endsWith(".github.io")) {
    return "";
  }

  return normalizeBasePath(repositoryName);
}

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const basePath = isGitHubPages ? githubPagesBasePath() : "";
// Vinext 1.0.0-beta.2 currently skips prerendering when output:export and
// basePath are both active. CI exports at the artifact root and keeps the
// public Pages prefix as assetPrefix; the workflow then normalizes _next.
const useVinextStaticRoot =
  isGitHubPages &&
  process.env.GITHUB_PAGES_VINEXT_STATIC_ROOT === "true";

const nextConfig: NextConfig = isGitHubPages
  ? {
      output: "export",
      basePath: useVinextStaticRoot ? "" : basePath,
      assetPrefix: basePath,
      trailingSlash: true,
      images: {
        unoptimized: true,
      },
    }
  : {};

export default nextConfig;
