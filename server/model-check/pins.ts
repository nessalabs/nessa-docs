// Pinned TLC and Temurin builds. Checksums were recorded from the published
// release assets (TLC 1.7.4 jar, Temurin 21.0.13+9 JRE). A download is used
// only when its SHA-256 matches.

import { TLC_VERSION } from '../../shared/model-check.js';

export interface DownloadPin {
  readonly url: string;
  readonly sha256: string;
  /** `tar.gz` for Unix JREs, `zip` for Windows, `jar` for TLC. */
  readonly format: 'tar.gz' | 'zip' | 'jar';
}

export const TLA_JAR: DownloadPin = {
  url: `https://github.com/tlaplus/tlaplus/releases/download/v${TLC_VERSION}/tla2tools.jar`,
  sha256: '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88',
  format: 'jar',
};

/** Eclipse Temurin 21.0.13+9 JRE. Keys are `${process.platform}-${process.arch}`. */
export const JAVA_PINS: Readonly<Record<string, DownloadPin>> = {
  'darwin-arm64': {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.13_9.tar.gz',
    sha256: '225bab0a09491ef06835488cd942f5d2befa9a0410a2484f0c8bbcf7506ec09a',
    format: 'tar.gz',
  },
  'darwin-x64': {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_mac_hotspot_21.0.13_9.tar.gz',
    sha256: 'c909674b1c10c261b9a3fb7e9c0efebd303e33f88a4fe84be7135b5e2d711f89',
    format: 'tar.gz',
  },
  'linux-arm64': {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_aarch64_linux_hotspot_21.0.13_9.tar.gz',
    sha256: 'b1734db7ade49c3f6acc6ae06233b8c2dd90e3e2f00f67000ae1c972aaa64d8c',
    format: 'tar.gz',
  },
  'linux-x64': {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_linux_hotspot_21.0.13_9.tar.gz',
    sha256: 'a535a1df9c6284d9618872984e026ae0352d1f7e9e0605425c0e6114f47351dd',
    format: 'tar.gz',
  },
  'win32-x64': {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_windows_hotspot_21.0.13_9.zip',
    sha256: '2332c0b4cff6bed722da3567c91d5e47568bcba863fa4945d0a8d6fc76158628',
    format: 'zip',
  },
};

export function javaPin(platform: NodeJS.Platform = process.platform, arch: string = process.arch): DownloadPin | null {
  return JAVA_PINS[`${platform}-${arch}`] ?? null;
}
