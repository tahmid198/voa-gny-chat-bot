/** @type {import('next').NextConfig} */
const nextConfig = {
  // These parse documents on the server only; keep them out of the bundle.
  serverExternalPackages: ["unpdf", "mammoth", "xlsx"],
};

export default nextConfig;
