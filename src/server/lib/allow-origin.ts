const patterns = [
  /^https:\/\/(?:www\.)?lifeflourishconsulting\.com$/,
  /^https:\/\/lifeflourishconsulting\.netlify\.app$/,
  /^https:\/\/staging--profound-seahorse-147612\.netlify\.app$/,
  /^https:\/\/deploy-preview-\d+--profound-seahorse-147612\.netlify\.app$/,
  /^https:\/\/[a-z0-9-]+--profound-seahorse-147612\.netlify\.app$/,
];

export const allowOrigin = (origin?: string) => {
  if (!origin) return "";
  return patterns.some((pattern) => pattern.test(origin)) ? origin : "";
};
