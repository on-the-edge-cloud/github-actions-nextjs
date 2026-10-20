import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

const config: OpenNextConfig = {
  default: {},
  imageOptimization: {
    install: {
      packages: ["sharp@0.35.5"],
      arch: "x64",
      os: "linux",
      libc: "glibc",
      nodeVersion: "22",
    },
  },
};

export default config;