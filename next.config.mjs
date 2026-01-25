import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const baseConfig = {
  transpilePackages: [
    "antd",
    "@ant-design/icons",
    "@ant-design/icons-svg",
    "rc-util",
    "rc-picker",
    "rc-table",
    "rc-tree",
    "rc-pagination",
    "rc-input"
  ]
};

export default function nextConfig(phase) {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...baseConfig,
      distDir: ".next-dev"
    };
  }
  return {
    ...baseConfig,
    distDir: ".next"
  };
}
