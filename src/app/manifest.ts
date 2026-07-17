import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/accounts",
    name: "MeadowBrook CRM",
    short_name: "MeadowBrook CRM",
    description: "MeadowBrook customer relationship management",
    start_url: "/accounts",
    scope: "/",
    display: "standalone",
    background_color: "#f6f8fb",
    theme_color: "#111111",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/meadowbrook-crm-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/meadowbrook-crm-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
