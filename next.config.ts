import type { NextConfig } from "next"

// Thumbnails are served from the Supabase Storage bucket `thumbnails`.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
  : null

const nextConfig: NextConfig = {
  // The default bottom-left position covers the user menu in the sidebar footer.
  devIndicators: { position: "bottom-right" },
  images: {
    remotePatterns: supabaseUrl
      ? [
          {
            protocol: supabaseUrl.protocol.replace(":", "") as "http" | "https",
            hostname: supabaseUrl.hostname,
            port: supabaseUrl.port,
            pathname: "/storage/v1/object/public/thumbnails/**",
          },
        ]
      : [],
    // Thumbnails never change once stored.
    minimumCacheTTL: 2678400,
    // Next.js 16 blocks optimizing images from local IPs; the local Supabase stack runs on
    // 127.0.0.1, so allow it in development only.
    dangerouslyAllowLocalIP: process.env.NODE_ENV === "development",
  },
}

export default nextConfig
