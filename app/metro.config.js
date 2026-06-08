const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// `@pulse/shared` is a local package symlinked into node_modules (file:../shared).
// Watch the workspace root so Metro's file map includes the real ../shared files,
// and let it resolve modules from both node_modules trees.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// `@pulse/shared` exposes its entry points via the package.json "exports" map.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
