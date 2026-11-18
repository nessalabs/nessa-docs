declare module 'path-browserify' {
  import type { posix } from 'node:path';
  const path: typeof posix;
  export default path;
}
