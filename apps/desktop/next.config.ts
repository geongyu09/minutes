import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // workspace 패키지(@minutes/core)는 TS 소스를 직접 참조하므로 트랜스파일 대상에 포함한다
  transpilePackages: ['@minutes/core'],
};

export default nextConfig;
