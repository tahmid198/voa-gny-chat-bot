/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app is a frontend and a proxy; document parsing happens in the
  // maud-ai service, so there are no server-only packages to exclude.
};

export default nextConfig;
