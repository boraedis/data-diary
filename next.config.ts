import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Binary media (images, the facelapse video) lives in Vercel Blob, not
    // committed to the repo — see #163. Every store's public URL is
    // "<store-id>.public.blob.vercel-storage.com", so a single-segment
    // wildcard covers the store without opening up arbitrary hosts.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
