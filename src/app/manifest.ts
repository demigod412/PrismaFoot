import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PitchEdge",
    short_name: "PitchEdge",
    description: "Calibrated football probabilities with a public accuracy ledger.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#0B1220",
    background_color: "#070B14",
    categories: ["sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Fixtures", url: "/" },
      { name: "Safe scanner", url: "/scanner/safe" },
      { name: "Accuracy", url: "/accuracy" },
    ],
  };
}
